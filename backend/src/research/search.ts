// Tavily web search wrapper — used by agents to gather evidence before voting.
import { env } from '../config.js';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface SearchOpts {
  maxResults?: number;
  daysBack?: number; // restrict to recent content
}

/**
 * Query Tavily. Returns up to maxResults compact results.
 * Throws on HTTP/parse error so caller can fall back to LLM-without-search.
 */
export async function tavilySearch(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const maxResults = opts.maxResults ?? env.SEARCH_MAX_RESULTS;
  const body: any = {
    api_key: env.TAVILY_API_KEY,
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };
  if (opts.daysBack) {
    const d = new Date(Date.now() - opts.daysBack * 86_400_000);
    body.days = opts.daysBack;
    void d;
  }

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`tavily ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as any;
  if (!Array.isArray(data.results)) {
    throw new Error(`tavily: malformed response (no results array)`);
  }

  return data.results.slice(0, maxResults).map((r: any): SearchResult => ({
    title: String(r.title ?? '').slice(0, 240),
    url: String(r.url ?? ''),
    content: String(r.content ?? '').slice(0, 1200),
    publishedDate: r.published_date ? String(r.published_date) : undefined,
  }));
}

/**
 * Compact a list of results into a single text blob suitable for an LLM context window.
 */
export function formatForLLM(results: SearchResult[]): string {
  if (results.length === 0) return '(no search results available)';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}${r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : ''}\n    ${r.content}`)
    .join('\n\n')
    .slice(0, 6000);
}
