// END-TO-END TEST on Arb Sepolia.
//
// Runs the complete lifecycle for ONE question:
//   1. Submit a fresh question via backend wallet
//   2. Run all 5 agents (4 parallel + Synthesis last) — each encrypts via CoFHE
//      and submits an on-chain vote
//   3. triggerResolution
//   4. Decrypt both tallies via CoFHE
//   5. publishResult (backend)
//   6. updateReputations (backend)
//   7. Verify final state on-chain
//
// Costs ~6 on-chain txs. Run sparingly.
import { ethers } from 'ethers';
import {
  backendContract,
  waitTx,
  getQuestion,
  questionCounter,
  readContract,
  StatusLabel,
  VoteLabel,
} from '../contract.js';
import { runAllAgents } from '../agents/agent.js';
import { resolveQuestion } from '../resolution/resolver.js';
import { upsertQuestionRecord, emit } from '../db.js';
import { backendWallet } from '../config.js';

async function main() {
  const startTime = Date.now();
  console.log('════════════════════════════════════════════════════════════');
  console.log('  VERITAS-FHENIX  ·  E2E TEST  ·  Arb Sepolia (real FHE)');
  console.log('════════════════════════════════════════════════════════════\n');
  console.log(`backend: ${backendWallet.address}\n`);

  // ── 1. Submit question ──────────────────────────────────────
  const question = process.env.E2E_QUESTION ?? 'Will Bitcoin close above $200,000 on July 11, 2026?';
  console.log(`▸ Step 1: submitting question`);
  console.log(`    "${question}"`);
  const beforeCounter = Number(await questionCounter());
  const submitTx = await backendContract.submitQuestion(question);
  await waitTx(submitTx, 1);
  const afterCounter = Number(await questionCounter());
  const qid = afterCounter - 1;
  console.log(`    ✓ qid=${qid} tx=${submitTx.hash}\n`);

  // Seed DB record
  upsertQuestionRecord({
    qid,
    text: question,
    submitter: backendWallet.address,
    status: 0,
    discoveredAt: new Date().toISOString(),
    votes: {},
  });

  // ── 2. Run all 5 agents ─────────────────────────────────────
  console.log(`▸ Step 2: dispatching 5 AI agents (research → reason → encrypt → vote)\n`);
  const results = await runAllAgents(qid);

  console.log(`\n    ${results.length}/5 agents voted:`);
  for (const r of results) {
    const v = r.vote === 1 ? 'YES' : r.vote === 0 ? 'NO' : 'UNSURE';
    console.log(`      [${r.agentIndex}] ${r.agentName.padEnd(20)} ${v.padEnd(7)} @${r.confidence}  (model=${r.model})`);
    console.log(`          reason: ${r.reason}`);
    console.log(`          tx: ${r.txHash}`);
  }

  if (results.length < 5) {
    console.error(`\n❌ only ${results.length}/5 agents voted — aborting resolution`);
    process.exit(2);
  }

  // ── 3,4,5,6. Resolve ────────────────────────────────────────
  console.log(`\n▸ Step 3: resolving question (triggerResolution → decrypt → publish → reputations)`);
  const resolved = await resolveQuestion(qid);

  // ── 7. Verify final state ───────────────────────────────────
  console.log(`\n▸ Step 4: verifying on-chain state`);
  const finalQ = await getQuestion(qid);
  console.log(`    status: ${StatusLabel[finalQ.status]}`);
  console.log(`    result: ${VoteLabel[finalQ.result]}`);
  console.log(`    yesScorePlain: ${finalQ.yesScorePlain}`);
  console.log(`    noScorePlain:  ${finalQ.noScorePlain}`);
  console.log(`    voteCount:     ${finalQ.voteCount}`);

  // Cross-check with our local record
  const localYes = results.filter((r) => r.vote === 1).reduce((s, r) => s + r.confidence, 0);
  const localNo = results.filter((r) => r.vote === 0).reduce((s, r) => s + r.confidence, 0);
  console.log(`\n    local computation (sanity):`);
  console.log(`      YES sum = ${localYes}  (on-chain=${finalQ.yesScorePlain})`);
  console.log(`      NO  sum = ${localNo}   (on-chain=${finalQ.noScorePlain})`);

  if (Number(finalQ.yesScorePlain) !== localYes) {
    console.warn(`    ⚠️  YES mismatch — FHE roundtrip may have issue`);
  }
  if (Number(finalQ.noScorePlain) !== localNo) {
    console.warn(`    ⚠️  NO mismatch — FHE roundtrip may have issue`);
  }
  if (finalQ.status !== 3) {
    throw new Error(`expected final status=Resolved, got ${finalQ.status}`);
  }

  // Reputation check
  console.log(`\n    final agent reputations:`);
  for (const r of resolved.resolution?.reputationDeltas ?? []) {
    console.log(`      ${r.agent}  delta=${r.delta >= 0 ? '+' : ''}${r.delta}  →  ${r.newReputation}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ E2E SUCCESS — completed in ${elapsed}s`);
  console.log(`   ${results.length} encrypted votes → homomorphic tally → decrypted aggregate only`);
}

main().catch((e) => {
  console.error('\n❌ E2E FAILED:', e);
  process.exit(1);
});
