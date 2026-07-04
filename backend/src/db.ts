// JSON-backed key/value store. One file per logical namespace.
// Designed to be shared across API + orchestrator processes:
//   - Orchestrator writes votes to disk
//   - API reloads from disk on every read
//   - Events are forwarded from orchestrator child → API parent via IPC
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
mkdirSync(DATA_DIR, { recursive: true });

function pathFor(namespace: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(namespace)) {
    throw new Error(`invalid db namespace: ${namespace}`);
  }
  return resolve(DATA_DIR, `${namespace}.json`);
}

export function load<T>(namespace: string, fallback: T): T {
  const p = pathFor(namespace);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(namespace: string, value: T): void {
  writeFileSync(pathFor(namespace), JSON.stringify(value, null, 2));
}

// ─────────────────────────────────────────────────────────────────
// Typed shapes
// ─────────────────────────────────────────────────────────────────

export interface AgentVoteRecord {
  agentIndex: number;
  agentName: string;
  vote: 0 | 1 | 2;
  confidence: number;
  reason: string;
  reasonHash: string; // keccak256 hex
  model: string;
  searchSnippet: string;
  txHash?: string;
  submittedAt?: string;
  error?: string;
}

export interface QuestionRecord {
  qid: number;
  text: string;
  submitter: string;
  status: number; // contract status
  discoveredAt: string;
  votes: Record<number, AgentVoteRecord>; // keyed by agentIndex
  resolution?: {
    yesScore: number;
    noScore: number;
    result: 0 | 1 | 2;
    resolvedAt: string;
    publishTxHash?: string;
    reputationDeltas?: Array<{ agent: string; delta: number; newReputation: number }>;
  };
}

export interface DbShape {
  questions: Record<number, QuestionRecord>;
}

let DB: DbShape = load<DbShape>('db', { questions: {} });

/** Reload DB from disk. API calls this before every read. */
export function reloadDb(): void {
  DB = load<DbShape>('db', { questions: {} });
}

export function getQuestionRecord(qid: number): QuestionRecord | undefined {
  reloadDb();
  return DB.questions[qid];
}

export function upsertQuestionRecord(rec: QuestionRecord): void {
  reloadDb();
  DB.questions[rec.qid] = rec;
  save('db', DB);
}

export function patchQuestionRecord(qid: number, patch: Partial<QuestionRecord>): QuestionRecord {
  reloadDb();
  const existing = DB.questions[qid];
  if (!existing) throw new Error(`question ${qid} not in db`);
  const merged = { ...existing, ...patch };
  DB.questions[qid] = merged;
  save('db', DB);
  return merged;
}

export function setAgentVote(qid: number, vote: AgentVoteRecord): void {
  reloadDb();
  const rec = DB.questions[qid];
  if (!rec) throw new Error(`question ${qid} not in db`);
  rec.votes[vote.agentIndex] = vote;
  save('db', DB);
}

export function listQuestionIds(): number[] {
  reloadDb();
  return Object.keys(DB.questions).map(Number).sort((a, b) => a - b);
}

export function allQuestions(): QuestionRecord[] {
  reloadDb();
  return Object.values(DB.questions).sort((a, b) => a.qid - b.qid);
}

// ─────────────────────────────────────────────────────────────────
// Live event log for SSE — capped ring buffer, persisted to disk
// ─────────────────────────────────────────────────────────────────
export interface SseEvent {
  id: number;
  ts: string;
  type: string;
  qid?: number;
  agentIndex?: number;
  message: string;
  data?: Record<string, unknown> | unknown;
}

const MAX_EVENTS = 500;

function loadEvents(): { events: SseEvent[]; counter: number } {
  const raw = load<{ events: SseEvent[]; counter: number }>('events', { events: [], counter: 0 });
  return { events: raw.events.slice(-MAX_EVENTS), counter: raw.counter ?? 0 };
}

function saveEvents(events: SseEvent[], counter: number): void {
  save('events', { events: events.slice(-MAX_EVENTS), counter });
}

const persisted = loadEvents();
const EVENTS: SseEvent[] = persisted.events;
let eventCounter = persisted.counter;

/** Backfill events from historical DB records so the event log shows vote history. */
function backfillEventsFromDb() {
  // Only backfill if we have DB votes but no question/vote/resolve events yet.
  const db = load<DbShape>('db', { questions: {} });
  const hasVoteEvents = EVENTS.some(
    (e) => e.type === 'agent:submitted' || e.type === 'resolve:done' || e.type === 'question:discovered'
  );
  if (hasVoteEvents) return;
  const synthetic: SseEvent[] = [];
  for (const rec of Object.values(db.questions).sort((a, b) => a.qid - b.qid)) {
    synthetic.push({
      id: ++eventCounter,
      ts: rec.discoveredAt,
      type: 'question:discovered',
      qid: rec.qid,
      message: `New question ${rec.qid}: "${rec.text.slice(0, 80)}${rec.text.length > 80 ? '...' : ''}"`,
      data: { submitter: rec.submitter, voteCount: Object.keys(rec.votes).length },
    });
    for (const v of Object.values(rec.votes).sort((a, b) => a.agentIndex - b.agentIndex)) {
      if (v.submittedAt) {
        synthetic.push({
          id: ++eventCounter,
          ts: v.submittedAt,
          type: 'agent:submitted',
          qid: rec.qid,
          agentIndex: v.agentIndex,
          message: `${v.agentName} vote confirmed`,
          data: { txHash: v.txHash, vote: v.vote, confidence: v.confidence },
        });
      }
    }
    if (rec.resolution?.resolvedAt) {
      synthetic.push({
        id: ++eventCounter,
        ts: rec.resolution.resolvedAt,
        type: 'resolve:done',
        qid: rec.qid,
        message: `Question ${rec.qid} resolved: ${rec.resolution.result === 1 ? 'YES' : rec.resolution.result === 0 ? 'NO' : 'UNSURE'} (YES=${rec.resolution.yesScore} NO=${rec.resolution.noScore})`,
        data: { winner: rec.resolution.result, yesVal: rec.resolution.yesScore, noVal: rec.resolution.noScore },
      });
    }
  }
  EVENTS.push(...synthetic);
  if (EVENTS.length > MAX_EVENTS) EVENTS.splice(0, EVENTS.length - MAX_EVENTS);
  saveEvents(EVENTS, eventCounter);
}

backfillEventsFromDb();

/** Optional IPC forwarder set by orchestrator when running as child process. */
let ipcForwarder: ((ev: SseEvent) => void) | null = null;

export function setIpcForwarder(fn: ((ev: SseEvent) => void) | null): void {
  ipcForwarder = fn;
}

export function emit(type: string, message: string, opts: { qid?: number; agentIndex?: number; data?: Record<string, unknown> | unknown } = {}): SseEvent {
  const ev: SseEvent = {
    id: ++eventCounter,
    ts: new Date().toISOString(),
    type,
    message,
    qid: opts.qid,
    agentIndex: opts.agentIndex,
    data: opts.data,
  };

  // If we're the orchestrator child, forward events to the API parent.
  if (ipcForwarder) {
    ipcForwarder(ev);
    return ev;
  }

  EVENTS.push(ev);
  if (EVENTS.length > MAX_EVENTS) EVENTS.splice(0, EVENTS.length - MAX_EVENTS);
  saveEvents(EVENTS, eventCounter);
  // Notify SSE subscribers
  for (const sub of subscribers) {
    try {
      sub(ev);
    } catch {
      /* ignore */
    }
  }
  return ev;
}

export function injectEvent(ev: SseEvent): SseEvent {
  // Reassign a monotonic id from the parent process counter.
  const canonical = { ...ev, id: ++eventCounter };
  EVENTS.push(canonical);
  if (EVENTS.length > MAX_EVENTS) EVENTS.splice(0, EVENTS.length - MAX_EVENTS);
  saveEvents(EVENTS, eventCounter);
  for (const sub of subscribers) {
    try {
      sub(canonical);
    } catch {
      /* ignore */
    }
  }
  return canonical;
}

export function recentEvents(limit = 100, sinceId = 0): SseEvent[] {
  const out: SseEvent[] = [];
  for (let i = EVENTS.length - 1; i >= 0 && out.length < limit; i--) {
    if (EVENTS[i].id <= sinceId) break;
    out.unshift(EVENTS[i]);
  }
  return out;
}

type Subscriber = (ev: SseEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
