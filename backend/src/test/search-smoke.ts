import { tavilySearch, formatForLLM } from '../research/search.js';

async function main() {
  console.log('=== TAVILY SEARCH SMOKE TEST ===\n');
  const results = await tavilySearch('ETH price prediction July 2026', { maxResults: 3 });
  console.log(`got ${results.length} results\n`);
  for (const r of results) {
    console.log(`- ${r.title}`);
    console.log(`  ${r.url}`);
    console.log(`  ${r.content.slice(0, 120).replace(/\s+/g, ' ')}...`);
    if (r.publishedDate) console.log(`  published: ${r.publishedDate}`);
    console.log();
  }
  console.log('--- formatted (first 600 chars) ---');
  console.log(formatForLLM(results).slice(0, 600));
  console.log('\n✅ Tavily OK');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
