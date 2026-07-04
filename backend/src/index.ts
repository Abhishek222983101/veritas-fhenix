// HTTP API + SSE stream for the frontend.
// Also forks the orchestrator as a child process and forwards its events to SSE.
import express from 'express';
import cors from 'cors';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  readContract,
  getQuestion,
  questionCounter,
  getAgents,
  StatusLabel,
  VoteLabel,
} from './contract.js';
import {
  allQuestions,
  getQuestionRecord,
  recentEvents,
  subscribe,
  emit,
  injectEvent,
} from './db.js';
import { env, backendWallet } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildApp(): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ─── Health ────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    try {
      const counter = Number(await questionCounter());
      res.json({
        ok: true,
        contract: env.CONTRACT_ADDRESS,
        chainId: env.CHAIN_ID,
        backend: backendWallet.address,
        questionCounter: counter,
        ts: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // ─── Agents ────────────────────────────────────────────────
  app.get('/api/agents', async (_req, res) => {
    try {
      const agents = await getAgents();
      res.json(agents);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ─── All questions (DB + on-chain) ────────────────────────
  app.get('/api/questions', async (_req, res) => {
    try {
      const dbQs = allQuestions();
      const counter = Number(await questionCounter());
      const merged: any[] = [];
      for (let qid = 0; qid < counter; qid++) {
        const onChain = await getQuestion(qid);
        const dbRec = dbQs.find((q) => q.qid === qid);
        merged.push({
          qid,
          text: onChain.text,
          submitter: onChain.submitter,
          status: Number(onChain.status),
          statusLabel: StatusLabel[Number(onChain.status)],
          voteCount: Number(onChain.voteCount),
          result: Number(onChain.result),
          resultLabel: VoteLabel[Number(onChain.result)],
          createdAt: Number(onChain.createdAt),
          resolvedAt: Number(onChain.resolvedAt) || null,
          yesScorePlain: Number(onChain.yesScorePlain),
          noScorePlain: Number(onChain.noScorePlain),
          votes: dbRec ? Object.values(dbRec.votes) : [],
          resolution: dbRec?.resolution ?? null,
        });
      }
      res.json(merged);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ─── Single question ───────────────────────────────────────
  app.get('/api/questions/:qid', async (req, res) => {
    try {
      const qid = Number(req.params.qid);
      const onChain = await getQuestion(qid);
      const dbRec = getQuestionRecord(qid);
      res.json({
        qid,
        text: onChain.text,
        submitter: onChain.submitter,
        status: Number(onChain.status),
        statusLabel: StatusLabel[Number(onChain.status)],
        voteCount: Number(onChain.voteCount),
        result: Number(onChain.result),
        resultLabel: VoteLabel[Number(onChain.result)],
        createdAt: Number(onChain.createdAt),
        resolvedAt: Number(onChain.resolvedAt) || null,
        yesScorePlain: Number(onChain.yesScorePlain),
        noScorePlain: Number(onChain.noScorePlain),
        votes: dbRec ? Object.values(dbRec.votes) : [],
        resolution: dbRec?.resolution ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ─── Submit a new question ─────────────────────────────────
  app.post('/api/questions', async (req, res) => {
    try {
      const text = String(req.body?.text ?? '').trim();
      if (!text) {
        return res.status(400).json({ error: 'text is required' });
      }
      if (text.length > 256) {
        return res.status(400).json({ error: 'text too long (max 256)' });
      }

      const { backendContract, waitTx } = await import('./contract.js');
      const tx = await backendContract.submitQuestion(text);
      await waitTx(tx, 1);
      const counter = Number(await questionCounter());
      emit('question:submitted', `New question submitted: "${text.slice(0, 80)}..."`, {
        data: { txHash: tx.hash, qid: counter - 1 },
      });
      res.json({ ok: true, qid: counter - 1, txHash: tx.hash });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ─── SSE events stream ─────────────────────────────────────
  app.get('/api/events', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    // Send last N events as backlog
    const sinceId = Number(req.query.sinceId ?? 0);
    for (const ev of recentEvents(100, sinceId)) {
      res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }

    // Live subscription
    const unsub = subscribe((ev) => {
      try {
        res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* client gone */
      }
    });

    req.on('close', () => unsub());
  });

  return app;
}

export function startServer(port = env.PORT): import('http').Server {
  const app = buildApp();
  return app.listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
    emit('api:start', `API server started on :${port}`, {});
  });
}

// ─── Start API server and fork orchestrator child ────────────
function startOrchestratorChild(): void {
  const isCompiled = __dirname.endsWith('/dist') || __dirname.endsWith('\\dist');
  const ext = isCompiled ? 'js' : 'ts';
  const execArgv = isCompiled ? [] : ['--import', 'tsx'];
  const modulePath = resolve(__dirname, `orchestrator.${ext}`);

  console.log(`[runner] forking orchestrator: ${modulePath}`);
  const child = fork(modulePath, [], {
    execArgv,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  child.on('message', (msg: any) => {
    if (msg && msg.type === 'event' && msg.event) {
      injectEvent(msg.event as any);
    }
  });

  child.on('exit', (code) => {
    console.log(`[runner] orchestrator exited with code ${code}`);
    process.exit(code ?? 1);
  });

  child.on('error', (err) => {
    console.error('[runner] orchestrator error:', err);
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
  // Give the API a moment to bind before forking the orchestrator.
  setTimeout(startOrchestratorChild, 500);
}
