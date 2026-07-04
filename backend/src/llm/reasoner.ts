// LLM reasoner — Mistral primary, Groq fallback.
//
// Both backends are called with the same JSON-output contract:
//   {"vote": <0|1|2>, "confidence": <integer 1-100>, "reason": "<= 280 chars>"}
//
// We parse strictly and validate ranges. Any failure → throw so caller can fall back.
import { env } from '../config.js';

export interface LlmVerdict {
  vote: 0 | 1 | 2;
  confidence: number; // 1..100
  reason: string;
  model: string;
}

const MISTRAL_MODEL = 'mistral-large-latest';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function extractJson(raw: string): any {
  // Be tolerant: strip markdown fences if present, find the first {...} block.
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON object in LLM response: ${raw.slice(0, 200)}`);
  }
  const slice = s.slice(start, end + 1);
  return JSON.parse(slice);
}

function validateVerdict(obj: any, model: string): LlmVerdict {
  if (typeof obj !== 'object' || obj === null) throw new Error('verdict not an object');
  const vote = Number(obj.vote);
  const confidence = Number(obj.confidence);
  const reason = String(obj.reason ?? '').trim();

  if (![0, 1, 2].includes(vote)) throw new Error(`invalid vote ${vote}`);
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 100) {
    throw new Error(`invalid confidence ${confidence}`);
  }
  if (reason.length === 0) throw new Error('empty reason');
  if (reason.length > 280) {
    return { vote: vote as 0 | 1 | 2, confidence, reason: reason.slice(0, 277) + '...', model };
  }
  return { vote: vote as 0 | 1 | 2, confidence, reason, model };
}

async function callMistral(systemPrompt: string, userPrompt: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.LLM_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      throw new Error(`mistral ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('mistral: no content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.LLM_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      throw new Error(`groq ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('groq: no content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the verdict pipeline with Mistral primary → Groq fallback.
 * Returns the first successful verdict.
 */
export async function reason(
  systemPrompt: string,
  userPrompt: string
): Promise<LlmVerdict> {
  // Try Mistral first
  try {
    const raw = await callMistral(systemPrompt, userPrompt);
    return validateVerdict(extractJson(raw), MISTRAL_MODEL);
  } catch (e) {
    console.warn(`[llm] mistral failed: ${(e as Error).message}. falling back to groq...`);
  }

  // Fallback: Groq
  const raw = await callGroq(systemPrompt, userPrompt);
  return validateVerdict(extractJson(raw), GROQ_MODEL);
}
