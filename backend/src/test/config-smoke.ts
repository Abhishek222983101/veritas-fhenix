import { ethers } from 'ethers';
import { env, agents, backendWallet, provider } from '../config.js';

async function main() {
  console.log('=== CONFIG SMOKE TEST ===');
  console.log(`chainId: ${env.CHAIN_ID}`);
  console.log(`contract: ${env.CONTRACT_ADDRESS}`);
  console.log(`backend: ${backendWallet.address}`);
  console.log(`agents (${agents.length}):`);
  for (const a of agents) {
    console.log(`  [${a.index}] ${a.name} — ${a.address}`);
  }

  // Network reachability
  const net = await provider.getNetwork();
  console.log(`\nnetwork.chainId: ${net.chainId}`);
  if (Number(net.chainId) !== env.CHAIN_ID) {
    throw new Error(`chainId mismatch: env=${env.CHAIN_ID} rpc=${net.chainId}`);
  }

  const block = await provider.getBlockNumber();
  console.log(`latest block: ${block}`);

  const bal = await provider.getBalance(backendWallet.address);
  console.log(`backend balance: ${ethers.formatEther(bal)} ETH`);

  console.log('\n✅ Config OK');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
