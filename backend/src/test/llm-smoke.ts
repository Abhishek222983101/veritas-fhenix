import { reason } from '../llm/reasoner.js';
import { getPersonality } from '../agents/personalities.js';

async function main() {
  console.log('=== LLM REASONER SMOKE TEST ===\n');

  // Test each personality with a simple question
  const question = 'Will ETH close above $4000 on July 10, 2026?';
  const searchContext = '(no search results available — base your answer on general knowledge)';

  for (let i = 0; i < 5; i++) {
    const p = getPersonality(i);
    const userPrompt = `QUESTION: ${question}\n\nSEARCH CONTEXT:\n${searchContext}\n\nAnalyze and emit your verdict JSON now.`;
    console.log(`--- ${p.name} (${p.tagline}) ---`);
    const t0 = Date.now();
    try {
      const v = await reason(p.systemPrompt, userPrompt);
      const ms = Date.now() - t0;
      const voteLabel = v.vote === 1 ? 'YES' : v.vote === 0 ? 'NO' : 'UNSURE';
      console.log(`  vote=${voteLabel} confidence=${v.confidence} model=${v.model} (${ms}ms)`);
      console.log(`  reason: ${v.reason}`);
    } catch (e) {
      console.error(`  ❌ ${p.name} failed: ${(e as Error).message}`);
    }
    console.log();
  }

  console.log('✅ LLM smoke complete');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
