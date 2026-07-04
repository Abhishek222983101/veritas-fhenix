// Orchestrator — the main loop.
//
// Responsibilities:
//   1. Poll the contract's questionCounter() every N seconds.
//   2. For each new question id:
//        a. Insert a QuestionRecord in DB
//        b. Wait for status=Pending or Voting (so contract accepts votes)
//        c. Run all 5 agents (4 parallel + Synthesis last)
//        d. After all 5 votes confirmed, run resolver
//   3. On startup: replay any questions that are mid-flight (some votes missing, not yet resolved)
//
// This module is idempotent: re-running it won't double-submit votes because
// contract enforces one-vote-per-agent per question.
import { getQuestion, questionCounter } from './contract.js';
import {
  getQuestionRecord,
  upsertQuestionRecord,
  listQuestionIds,
  patchQuestionRecord,
  emit,
  setIpcForwarder,
} from './db.js';
import { runAllAgents } from './agents/agent.js';
import { resolveQuestion } from './resolution/resolver.js';
import { env } from './config.js';

// If running as a forked child of the API process, forward events via IPC.
if (process.send) {
  setIpcForwarder((ev) => {
    try {
      process.send!({ type: 'event', event: ev });
    } catch {
      /* parent gone */
    }
  });
}

const processed = new Set<number>();

function log(msg: string) {
  console.log(`[orchestrator] ${msg}`);
}

/**
 * Decide whether a question is "actionable" by us:
 *   - status Pending (0) or Voting (1) → can still accept votes
 *   - status Resolving (2) → skip voting, try to finish resolution
 *   - status Resolved (3) → already done
 */
function actionableStatus(s: number): boolean {
  return s === 0 || s === 1 || s === 2;
}

async function processQuestion(qid: number): Promise<void> {
  if (processed.has(qid)) return;
  processed.add(qid);

  const q = await getQuestion(qid);
  log(`question ${qid}: status=${q.status} voteCount=${q.voteCount} text="${q.text.slice(0, 60)}..."`);

  // Initialize DB record if missing
  let rec = getQuestionRecord(qid);
  if (!rec) {
    rec = {
      qid,
      text: q.text,
      submitter: q.submitter,
      status: q.status,
      discoveredAt: new Date().toISOString(),
      votes: {},
    };
    upsertQuestionRecord(rec);
    emit('question:discovered', `New question ${qid}: "${q.text.slice(0, 80)}${q.text.length > 80 ? '...' : ''}"`, {
      qid,
      data: { submitter: q.submitter, voteCount: Number(q.voteCount) },
    });
  }

  // Already resolved? Mark and skip.
  if (q.status === 3) {
    patchQuestionRecord(qid, { status: 3 });
    log(`question ${qid} already resolved — skipping`);
    return;
  }

  // Resolving but not yet published? Try to finish it.
  if (q.status === 2) {
    log(`question ${qid} is Resolving — attempting to publish result`);
    try {
      await resolveQuestion(qid);
    } catch (e) {
      emit('resolve:error', `Failed to resolve question ${qid}: ${(e as Error).message}`, {
        qid,
        data: { error: String(e) },
      });
      processed.delete(qid); // allow retry next loop
    }
    return;
  }

  // Pending or Voting: dispatch agents
  if (q.status === 0 || q.status === 1) {
    log(`question ${qid}: dispatching 5 agents`);
    emit('question:voting', `Dispatching 5 agents for question ${qid}`, { qid });
    try {
      const results = await runAllAgents(qid);
      log(`question ${qid}: ${results.length}/5 agents voted successfully`);

      if (results.length === 5) {
        // All 5 in. Read fresh state to confirm voteCount.
        const q2 = await getQuestion(qid);
        if (q2.voteCount === 5n && q2.status === 1) {
          log(`question ${qid}: all 5 votes confirmed — resolving`);
          await resolveQuestion(qid);
        } else {
          log(`question ${qid}: state unexpected after votes (status=${q2.status} voteCount=${q2.voteCount})`);
        }
      } else {
        emit('question:incomplete', `Question ${qid} only got ${results.length}/5 votes`, { qid });
      }
    } catch (e) {
      emit('question:error', `Question ${qid} pipeline failed: ${(e as Error).message}`, {
        qid,
        data: { error: String(e) },
      });
      processed.delete(qid); // allow retry
    }
  }
}

/**
 * Single pass: discover new questions, replay actionable ones.
 */
async function tick(): Promise<void> {
  try {
    const counter = await questionCounter();
    const total = Number(counter);
    const known = new Set(listQuestionIds());
    const onChainIds = Array.from({ length: total }, (_, i) => i);

    // 1. Brand new questions
    for (const qid of onChainIds) {
      if (!known.has(qid) && !processed.has(qid)) {
        await processQuestion(qid);
      }
    }

    // 2. Known but not yet resolved questions — re-check (in case votes were submitted externally)
    for (const qid of known) {
      const rec = getQuestionRecord(qid);
      if (!rec || rec.status === 3) continue;
      // Re-check on-chain status
      const q = await getQuestion(qid);
      if (actionableStatus(q.status) && !processed.has(qid)) {
        await processQuestion(qid);
      } else if (q.status === 3 && rec.status !== 3) {
        patchQuestionRecord(qid, { status: 3 });
      }
    }
  } catch (e) {
    emit('orchestrator:error', `tick failed: ${(e as Error).message}`, {
      data: { error: String(e) },
    });
    log(`tick error: ${(e as Error).message}`);
  }
}

/**
 * Run the orchestrator loop forever.
 */
export async function startOrchestrator(): Promise<void> {
  log('starting orchestrator loop');
  emit('orchestrator:start', 'Orchestrator started', {});

  // Initial pass — backfill any actionable questions
  await tick();

  // Schedule periodic ticks
  setInterval(() => {
    void tick();
  }, env.ORCHESTRATOR_POLL_MS);

  log(`polling every ${env.ORCHESTRATOR_POLL_MS}ms`);
}

// Allow `tsx src/orchestrator.ts` to run as a standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  startOrchestrator().catch((e) => {
    console.error('orchestrator fatal:', e);
    process.exit(1);
  });
}
