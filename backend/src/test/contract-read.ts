import { ethers } from 'ethers';
import {
  readContract,
  getQuestion,
  questionCounter,
  getAgents,
  getVoteReceipt,
  StatusLabel,
  VoteLabel,
} from '../contract.js';
import { agents, backendWallet } from '../config.js';

async function main() {
  console.log('=== CONTRACT READ SMOKE TEST ===');

  // 1. Raw calls
  const onChainBackend = (await readContract.backend()) as string;
  if (ethers.getAddress(onChainBackend) !== backendWallet.address) {
    throw new Error(
      `backend mismatch: on-chain=${onChainBackend} env=${backendWallet.address}`
    );
  }
  console.log(`✓ backend matches (${onChainBackend})`);

  const counter = await questionCounter();
  console.log(`✓ questionCounter = ${counter}`);

  const agentCount = Number((await readContract.getAgentCount()) as bigint);
  console.log(`✓ getAgentCount = ${agentCount}`);
  if (agentCount !== 5) throw new Error('expected 5 agents');

  // 2. getAgents parity check
  const onChainAgents = await getAgents();
  console.log('\n  On-chain agents:');
  for (let i = 0; i < onChainAgents.length; i++) {
    const a = onChainAgents[i];
    console.log(
      `    [${i}] ${a.name.padEnd(20)} rep=${a.reputation.toString().padStart(5)} active=${a.isActive} wallet=${a.wallet}`
    );
    // Verify our local agent wallet order matches on-chain registration
    if (ethers.getAddress(a.wallet) !== ethers.getAddress(agents[i].address)) {
      throw new Error(`agent[${i}] wallet mismatch: on-chain=${a.wallet} local=${agents[i].address}`);
    }
    if (a.name !== agents[i].name) {
      throw new Error(`agent[${i}] name mismatch: on-chain="${a.name}" local="${agents[i].name}"`);
    }
  }
  console.log('\n✓ all 5 on-chain agents match local config');

  // 3. Question #0 (smoke-test question from deployment)
  if (counter > 0n) {
    const q0 = await getQuestion(0);
    console.log(`\n  Question #0:`);
    console.log(`    text="${q0.text}"`);
    console.log(`    status=${StatusLabel[q0.status]} voteCount=${q0.voteCount} result=${VoteLabel[q0.result]}`);
    console.log(`    submitter=${q0.submitter}`);
    console.log(`    createdAt=${new Date(Number(q0.createdAt) * 1000).toISOString()}`);

    // Check each agent's vote receipt
    for (const a of agents) {
      const r = await getVoteReceipt(0, a.address);
      if (r.hasVoted) {
        console.log(`    vote by ${a.name}: hasVoted=true reasonHash=${r.reasonHash}`);
      }
    }
  }

  console.log('\n✅ CONTRACT READ OK');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
