import { getCofheClient, encryptVoteAndConfidence } from '../cofhe.js';
import { agents } from '../config.js';

async function main() {
  console.log('=== CoFHE SMOKE TEST (encryption only, no on-chain submit) ===\n');

  const agent = agents[0];
  console.log(`[cofhe-smoke] init client for ${agent.name} (${agent.address})...`);
  const client = await getCofheClient(agent.wallet);
  console.log(`[cofhe-smoke] client connected=${client.connected}\n`);

  // First encryption: ~15-20s (one-time FHE key fetch). Second: should be much faster.
  for (const [vote, conf, label] of [
    [1, 80, 'YES@80'],
    [0, 60, 'NO@60'],
    [2, 0, 'UNSURE@0'],
  ] as const) {
    const t0 = Date.now();
    const { encVote, encConfidence } = await encryptVoteAndConfidence(client, vote, conf);
    const ms = Date.now() - t0;
    console.log(
      `[cofhe-smoke] ${label} encrypted in ${ms}ms\n` +
        `   vote -> ctHash=${encVote.ctHash.toString().slice(0, 20)}... utype=${encVote.utype} sigLen=${(encVote.signature.length - 2) / 2}B\n` +
        `   conf -> ctHash=${encConfidence.ctHash.toString().slice(0, 20)}... utype=${encConfidence.utype} sigLen=${(encConfidence.signature.length - 2) / 2}B\n`
    );

    // Sanity invariants
    if (encVote.utype !== 2) throw new Error(`vote utype must be 2 (Uint8), got ${encVote.utype}`);
    if (encConfidence.utype !== 2) throw new Error(`conf utype must be 2 (Uint8), got ${encConfidence.utype}`);
    if (!encVote.signature.startsWith('0x')) throw new Error('vote signature must be 0x hex');
    if (!encConfidence.signature.startsWith('0x')) throw new Error('conf signature must be 0x hex');
    // ciphertext hashes must be unique per encryption
    if (encVote.ctHash === encConfidence.ctHash) {
      throw new Error('vote and confidence ctHashes collided — encryption is broken');
    }
  }

  console.log('✅ CoFHE encryption OK');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
