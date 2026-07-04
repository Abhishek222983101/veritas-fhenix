// Resolver — runs after all 5 agents have voted on a question.
//
// Flow:
//   1. triggerResolution(qid)         — anyone calls; sets status Resolving, allowPublic on tallies
//   2. decryptTally(yesScore)         — CoFHE /decrypt via global-allowance path
//   3. decryptTally(noScore)          — same
//   4. publishResult(yesVal, yesSig, noVal, noSig)  — backend-only tx, publishDecryptResult verifies sigs on-chain
//   5. updateReputations(...)         — backend-only, transparent deltas based on local plaintext knowledge
import { ethers } from 'ethers';
import { backendWallet, agents } from '../config.js';
import {
  getQuestion,
  triggerResolution,
  publishResult,
  updateReputations,
  waitTx,
  readContract,
  Vote,
} from '../contract.js';
import { getCofheClient, decryptTally } from '../cofhe.js';
import { getQuestionRecord, patchQuestionRecord, emit, type QuestionRecord } from '../db.js';

// Reputation params
const REP_DELTA_CORRECT = 50;
const REP_DELTA_WRONG = -30;
const REP_DELTA_ABSTAIN = 0; // UNSURE never changes rep

/**
 * Read the on-chain euint16 ctHashes for yesScore and noScore of a question.
 * These are mappings keyed by qid; we read the public getter.
 */
async function readTallyCtHashes(qid: number): Promise<{ yesCtHash: bigint; noCtHash: bigint }> {
  // yesScore(qid) and noScore(qid) are public mappings → getters return the euint16 handle,
  // which the contract stores as a single uint256 ctHash (per CoFHE storage layout).
  const yesHandle = (await readContract.yesScore(qid)) as unknown;
  const noHandle = (await readContract.noScore(qid)) as unknown;
  // CoFHE euint16 mapping returns uint256 ctHash directly
  return {
    yesCtHash: BigInt((yesHandle as any) ?? 0),
    noCtHash: BigInt((noHandle as any) ?? 0),
  };
}

/**
 * Resolve a question fully: trigger → decrypt → publish → rep update.
 * Returns the resolution record.
 */
export async function resolveQuestion(qid: number): Promise<QuestionRecord> {
  emit('resolve:start', `Resolving question ${qid}`, { qid });

  const rec = getQuestionRecord(qid);
  if (!rec) throw new Error(`question ${qid} not in db`);

  // ─── 1. Trigger resolution (idempotent: only valid when status=Voting) ───
  const qBefore = await getQuestion(qid);
  if (qBefore.status === 1 /* Voting */) {
    emit('resolve:trigger', `Calling triggerResolution for question ${qid}`, { qid });
    const trigTx = await triggerResolution(qid);
    await waitTx(trigTx, 1);
    emit('resolve:triggered', `Resolution triggered (tx=${trigTx.hash.slice(0, 12)}...)`, {
      qid,
      data: { txHash: trigTx.hash },
    });
  } else if (qBefore.status === 2 /* Resolving */) {
    emit('resolve:trigger', `Question ${qid} already Resolving — skipping triggerResolution`, { qid });
  } else {
    throw new Error(`question ${qid} in unexpected status ${qBefore.status} (expected Voting or Resolving)`);
  }

  // ─── 2. Read tally ctHashes ───
  const { yesCtHash, noCtHash } = await readTallyCtHashes(qid);
  if (yesCtHash === 0n || noCtHash === 0n) {
    throw new Error(`question ${qid}: tally ctHash is zero (yes=${yesCtHash} no=${noCtHash})`);
  }
  emit('resolve:decrypt', `Decrypting tallies via CoFHE (yesCtHash=${yesCtHash.toString().slice(0, 18)}...)`, { qid });

  // ─── 3. Decrypt both tallies (backend wallet context, global-allowance /decrypt) ───
  const backendClient = await getCofheClient(backendWallet);
  const [yesDecrypted, noDecrypted] = await Promise.all([
    decryptTally(backendClient, yesCtHash),
    decryptTally(backendClient, noCtHash),
  ]);

  const yesVal = Number(yesDecrypted.decryptedValue);
  const noVal = Number(noDecrypted.decryptedValue);
  if (yesVal < 0 || yesVal > 65535) throw new Error(`yesVal out of uint16 range: ${yesVal}`);
  if (noVal < 0 || noVal > 65535) throw new Error(`noVal out of uint16 range: ${noVal}`);

  emit('resolve:decrypted', `Decrypted: YES=${yesVal} NO=${noVal}`, {
    qid,
    data: { yesVal, noVal },
  });

  // ─── 4. Publish result on-chain ───
  emit('resolve:publish', `Publishing result via backend wallet...`, { qid });
  const pubTx = await publishResult(qid, yesVal, yesDecrypted.signature, noVal, noDecrypted.signature);
  await waitTx(pubTx, 1);
  emit('resolve:published', `Result published (tx=${pubTx.hash.slice(0, 12)}...)`, {
    qid,
    data: { txHash: pubTx.hash, yesVal, noVal },
  });

  // ─── 5. Compute + apply reputation deltas ───
  // Backend knows plaintext votes because it encrypted them client-side.
  // Determine the consensus winner from the decrypted tallies.
  let winner: 0 | 1 | 2;
  if (yesVal > noVal) winner = Vote.Yes;
  else if (noVal > yesVal) winner = Vote.No;
  else winner = Vote.Unsure;

  const agentAddrs: string[] = [];
  const deltas: bigint[] = [];
  const repDeltas: Array<{ agent: string; delta: number; newReputation: number }> = [];

  for (const agent of agents) {
    const v = rec.votes[agent.index];
    if (!v) continue; // didn't vote

    let delta: number;
    if (v.vote === winner) {
      delta = REP_DELTA_CORRECT;
    } else if (v.vote === Vote.Unsure || winner === Vote.Unsure) {
      delta = REP_DELTA_ABSTAIN;
    } else {
      delta = REP_DELTA_WRONG;
    }

    // Read current reputation from chain to compute new
    const onChain = await readContract.getAgent(agent.address);
    const oldRep = BigInt((onChain as any).reputation ?? 1000);
    let newRep = Number(oldRep) + delta;
    if (newRep < 0) newRep = 0;
    if (newRep > 10000) newRep = 10000;

    agentAddrs.push(agent.address);
    deltas.push(BigInt(delta));
    repDeltas.push({ agent: agent.address, delta, newReputation: newRep });
  }

  if (agentAddrs.length > 0) {
    emit('resolve:reputation', `Updating reputations (${agentAddrs.length} agents)`, {
      qid,
      data: { repDeltas },
    });
    const repTx = await updateReputations(qid, agentAddrs, deltas);
    await waitTx(repTx, 1);
    emit('resolve:reputationUpdated', `Reputations updated (tx=${repTx.hash.slice(0, 12)}...)`, {
      qid,
      data: { txHash: repTx.hash },
    });
  }

  // Persist final state
  const updated = patchQuestionRecord(qid, {
    status: 3 /* Resolved */,
    resolution: {
      yesScore: yesVal,
      noScore: noVal,
      result: winner,
      resolvedAt: new Date().toISOString(),
      publishTxHash: pubTx.hash,
      reputationDeltas: repDeltas,
    },
  });

  emit('resolve:done', `Question ${qid} resolved: ${winner === 1 ? 'YES' : winner === 0 ? 'NO' : 'UNSURE'} (YES=${yesVal} NO=${noVal})`, {
    qid,
    data: { winner, yesVal, noVal },
  });

  return updated;
}
