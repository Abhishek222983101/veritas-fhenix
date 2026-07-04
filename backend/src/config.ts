import 'dotenv/config';
import { ethers } from 'ethers';
import { z } from 'zod';

const EnvSchema = z.object({
  // LLM / Search APIs
  MISTRAL_API_KEY: z.string().min(10, 'MISTRAL_API_KEY missing'),
  GROQ_API_KEY: z.string().min(10, 'GROQ_API_KEY missing'),
  TAVILY_API_KEY: z.string().min(10, 'TAVILY_API_KEY missing'),

  // Blockchain
  ARBITRUM_SEPOLIA_RPC_URL: z.string().url().default('https://sepolia-rollup.arbitrum.io/rpc'),
  CHAIN_ID: z.coerce.number().int().positive().default(421614),
  CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid CONTRACT_ADDRESS'),

  // Backend signer
  BACKEND_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid BACKEND_PRIVATE_KEY'),

  // 5 agents
  AGENT_1_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  AGENT_2_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  AGENT_3_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  AGENT_4_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  AGENT_5_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),

  // Optional tuning
  ORCHESTRATOR_POLL_MS: z.coerce.number().int().positive().default(5_000),
  AGENT_VOTE_DELAY_MS: z.coerce.number().int().nonnegative().default(1_500),
  PORT: z.coerce.number().int().positive().default(3001),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SEARCH_MAX_RESULTS: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AgentKey {
  index: number;
  name: string;
  personality: string;
  privateKey: string;
  address: string;
  wallet: ethers.Wallet;
}

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = parseEnv();

export const AGENT_NAMES = [
  'Oracle Alpha',
  'Skeptic Beta',
  'Signal Gamma',
  'Risk Delta',
  'Synthesis Epsilon',
] as const;

export const AGENT_PERSONALITIES = [
  'The visionary — believes in upside scenarios, momentum, and adoption curves. Will lean YES unless evidence strongly contradicts.',
  'The skeptic — defaults to doubt. Demands extraordinary evidence for YES. Weight on counterarguments and tail-risks.',
  'The signal-hunter — pattern matches against historical precedents, technical indicators, and on-chain data. Numerate.',
  'The risk-manager — focuses on downside, volatility, black swans, and what could go wrong. Conservative bias.',
  'The synthesizer — weighs all four other agents, looks for consensus, dissents only when the balance is unclear. Last to decide.',
] as const;

function buildProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    env.ARBITRUM_SEPOLIA_RPC_URL,
    env.CHAIN_ID,
    { staticNetwork: true, batchMaxCount: 5 }
  );
}

function buildAgents(): AgentKey[] {
  const provider = buildProvider();
  const keys = [
    env.AGENT_1_PRIVATE_KEY,
    env.AGENT_2_PRIVATE_KEY,
    env.AGENT_3_PRIVATE_KEY,
    env.AGENT_4_PRIVATE_KEY,
    env.AGENT_5_PRIVATE_KEY,
  ];

  return keys.map((pk, i) => {
    const wallet = new ethers.Wallet(pk, provider);
    return {
      index: i,
      name: AGENT_NAMES[i],
      personality: AGENT_PERSONALITIES[i],
      privateKey: pk,
      address: wallet.address,
      wallet,
    };
  });
}

export const agents = buildAgents();

export const provider = buildProvider();

export const backendWallet = new ethers.Wallet(env.BACKEND_PRIVATE_KEY, provider);

// Sanity invariant: backend env address must match derived wallet
if (process.env.BACKEND_ADDRESS && ethers.getAddress(process.env.BACKEND_ADDRESS) !== backendWallet.address) {
  console.error(`❌ BACKEND_ADDRESS mismatch: env=${process.env.BACKEND_ADDRESS} key=${backendWallet.address}`);
  process.exit(1);
}

console.log(`[config] backend=${backendWallet.address}`);
console.log(`[config] agents=${agents.map((a) => `${a.name}:${a.address.slice(0, 8)}`).join(', ')}`);
console.log(`[config] contract=${env.CONTRACT_ADDRESS} chain=${env.CHAIN_ID}`);
