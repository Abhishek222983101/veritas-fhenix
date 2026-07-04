import { ethers, Contract, ContractTransaction, ContractTransactionResponse } from 'ethers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { env, provider, backendWallet, agents, type AgentKey } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABI_PATH = resolve(__dirname, '../abi.json');
const RAW_ABI = JSON.parse(readFileSync(ABI_PATH, 'utf8')) as ethers.InterfaceAbi;

// InEuint8 struct { uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature; }
// CoFHE SDK EncryptedItemInput is `{ ctHash: bigint; securityZone: number; utype: FheTypes; signature: \`0x${string}\` }`
// → we'll accept a normalized shape and serialize as a tuple for ethers.
export interface EncryptedInput {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
}

// Vote enum (matches contract)
export const Vote = {
  No: 0,
  Yes: 1,
  Unsure: 2,
} as const;
export type VoteValue = (typeof Vote)[keyof typeof Vote];
export const VoteLabel: Record<number, string> = { 0: 'No', 1: 'Yes', 2: 'Unsure' };

// Status enum (matches contract)
export const Status = {
  Pending: 0,
  Voting: 1,
  Resolving: 2,
  Resolved: 3,
} as const;
export type StatusValue = (typeof Status)[keyof typeof Status];
export const StatusLabel: Record<number, string> = {
  0: 'Pending',
  1: 'Voting',
  2: 'Resolving',
  3: 'Resolved',
};

export interface QuestionOnChain {
  id: bigint;
  text: string;
  submitter: string;
  status: number;
  createdAt: bigint;
  voteCount: bigint;
  result: number;
  yesScorePlain: bigint;
  noScorePlain: bigint;
  resolvedAt: bigint;
}

export interface AgentOnChain {
  wallet: string;
  name: string;
  personality: string;
  reputation: number;
  isActive: boolean;
}

export interface VoteReceiptOnChain {
  hasVoted: boolean;
  reasonHash: string;
}

// ─────────────────────────────────────────────────────────────────
// Read-only contract handle (no signer)
// ─────────────────────────────────────────────────────────────────
export const readContract = new Contract(env.CONTRACT_ADDRESS, RAW_ABI, provider);

// ─────────────────────────────────────────────────────────────────
// Write helpers — one per wallet
// ─────────────────────────────────────────────────────────────────
function writeContractFor(wallet: ethers.Wallet): Contract {
  return new Contract(env.CONTRACT_ADDRESS, RAW_ABI, wallet);
}

export const backendContract = writeContractFor(backendWallet);
export const agentContracts = new Map<number, Contract>(
  agents.map((a) => [a.index, writeContractFor(a.wallet)])
);

// ─────────────────────────────────────────────────────────────────
// Typed read functions
// ─────────────────────────────────────────────────────────────────
export async function getQuestion(qid: number | bigint): Promise<QuestionOnChain> {
  const q = await readContract.getQuestion(qid);
  return {
    id: q[0],
    text: q[1],
    submitter: q[2],
    status: Number(q[3]),
    createdAt: q[4],
    voteCount: q[5],
    result: Number(q[6]),
    yesScorePlain: q[7],
    noScorePlain: q[8],
    resolvedAt: q[9],
  };
}

export async function questionCounter(): Promise<bigint> {
  return (await readContract.questionCounter()) as bigint;
}

export async function getAgents(): Promise<AgentOnChain[]> {
  const arr = (await readContract.getAgents()) as any[];
  return arr.map((a) => ({
    wallet: a.wallet,
    name: a.name,
    personality: a.personality,
    reputation: Number(a.reputation),
    isActive: a.isActive,
  }));
}

export async function getAgent(wallet: string): Promise<AgentOnChain> {
  const a = await readContract.getAgent(wallet);
  return {
    wallet: a.wallet,
    name: a.name,
    personality: a.personality,
    reputation: Number(a.reputation),
    isActive: a.isActive,
  };
}

export async function getVoteReceipt(qid: number | bigint, agent: string): Promise<VoteReceiptOnChain> {
  const r = await readContract.getVoteReceipt(qid, agent);
  return { hasVoted: r.hasVoted, reasonHash: r.reasonHash };
}

// ─────────────────────────────────────────────────────────────────
// Write functions
// ─────────────────────────────────────────────────────────────────

/**
 * Submit an encrypted vote as an agent.
 * @param agent  Agent descriptor (must match one of the 5 wallets)
 * @param qid    Question id
 * @param encVote  Encrypted vote ciphertext tuple
 * @param encConf  Encrypted confidence ciphertext tuple
 * @param reasonHash  keccak256 of plaintext reason
 */
export async function submitVote(
  agent: AgentKey,
  qid: number | bigint,
  encVote: EncryptedInput,
  encConf: EncryptedInput,
  reasonHash: string
): Promise<ContractTransactionResponse> {
  const c = agentContracts.get(agent.index);
  if (!c) throw new Error(`No contract for agent ${agent.index}`);

  // Encode as tuple for ABI: [ctHash, securityZone, utype, signature]
  const encVoteTuple = [encVote.ctHash, encVote.securityZone, encVote.utype, encVote.signature];
  const encConfTuple = [encConf.ctHash, encConf.securityZone, encConf.utype, encConf.signature];

  const tx: ContractTransactionResponse = await c.submitVote(
    qid,
    encVoteTuple,
    encConfTuple,
    reasonHash
  );
  return tx;
}

export async function triggerResolution(qid: number | bigint): Promise<ContractTransactionResponse> {
  // Anyone can call this. Use backend wallet for determinism.
  return (await backendContract.triggerResolution(qid)) as ContractTransactionResponse;
}

export async function publishResult(
  qid: number | bigint,
  yesVal: number,
  yesSig: string,
  noVal: number,
  noSig: string
): Promise<ContractTransactionResponse> {
  return (await backendContract.publishResult(
    qid,
    yesVal,
    yesSig,
    noVal,
    noSig
  )) as ContractTransactionResponse;
}

export async function updateReputations(
  qid: number | bigint,
  agentAddrs: string[],
  deltas: bigint[]
): Promise<ContractTransactionResponse> {
  if (agentAddrs.length !== deltas.length) {
    throw new Error('updateReputations: address/delta length mismatch');
  }
  return (await backendContract.updateReputations(
    qid,
    agentAddrs,
    deltas
  )) as ContractTransactionResponse;
}

/**
 * Wait for a tx to be mined, with confirmation.
 */
export async function waitTx(tx: ContractTransactionResponse, confirmations = 1): Promise<void> {
  const receipt = await tx.wait(confirmations);
  if (receipt === null || receipt.status !== 1) {
    throw new Error(`tx ${tx.hash} failed (status=${receipt?.status ?? 'null'})`);
  }
}

export { RAW_ABI };
