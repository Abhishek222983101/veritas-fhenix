// Single agent pipeline.
//
// Pipeline (per agent, per question):
//   1. Fetch on-chain question text
//   2. Search Tavily for evidence (with graceful fallback on failure)
//   3. Call LLM (Mistral → Groq) with personality + question + search context
//   4. Encrypt (vote, confidence) via CoFHE SDK
//   5. Compute reasonHash = keccak256(reason)
//   6. Submit on-chain via submitVote() — agent wallet signs the tx
//   7. Persist to db
//
// Special handling: agent #5 (Synthesis Epsilon) sees the other 4 verdicts in its prompt.
import { ethers } from 'ethers';
import { type AgentKey, agents } from '../config.js';
import { getQuestion, submitVote, waitTx, type EncryptedInput } from '../contract.js';
import { getCofheClient, encryptVoteAndConfidence } from '../cofhe.js';
import { reason } from '../llm/reasoner.js';
import { tavilySearch, formatForLLM, type SearchResult } from '../research/search.js';
import { getPersonality } from './personalities.js';
import { setAgentVote, type AgentVoteRecord, emit } from '../db.js';

export interface AgentRunResult {
  agentIndex: number;
  agentName: string;
  vote: 0 | 1 | 2;
  confidence: number;
  reason: string;
  reasonHash: string;
  txHash: string;
  model: string;
}

interface OtherAgentContext {
  name: string;
  vote: 0 | 1 | 2;
  confidence: number;
  reason: string;
}

/**
 * Run one agent on one question.
 *
 * @param agent       Which agent (0..4)
 * @param qid         Question id
 * @param others      Optional — the other 4 agents' verdicts, used only for agent #4 (Synthesis)
 */
export async function runAgent(
  agent: AgentKey,
  qid: number,
  others?: OtherAgentContext[]
): Promise<AgentRunResult> {
  const p = getPersonality(agent.index);
  emit('agent:start', `${p.name} starting research`, { qid, agentIndex: agent.index });

  // 1. Read question
  const q = await getQuestion(qid);
  if (q.status !== 0 && q.status !== 1) {
    throw new Error(`question ${qid} not in voting window (status=${q.status})`);
  }

  // 2. Search
  let results: SearchResult[] = [];
  let searchSnippet = '(no search results available)';
  try {
    results = await tavilySearch(q.text, { maxResults: 4, daysBack: 30 });
    searchSnippet = formatForLLM(results);
    emit('agent:search', `${p.name} found ${results.length} sources`, { qid, agentIndex: agent.index });
  } catch (e) {
    emit('agent:search', `${p.name} search failed — proceeding without`, {
      qid,
      agentIndex: agent.index,
      data: { error: (e as Error).message },
    });
  }

  // 3. Reason
  let userPrompt = `QUESTION: ${q.text}\n\nSEARCH CONTEXT:\n${searchSnippet}\n`;
  if (agent.index === 4 && others && others.length > 0) {
    // Synthesis Epsilon gets to see all other agent verdicts
    const opinions = others
      .map((o) => `- ${o.name}: ${o.vote === 1 ? 'YES' : o.vote === 0 ? 'NO' : 'UNSURE'} @${o.confidence} — ${o.reason}`)
      .join('\n');
    userPrompt += `\nOTHER AGENT OPINIONS:\n${opinions}\n`;
  }
  userPrompt += '\nAnalyze and emit your verdict JSON now.';

  emit('agent:reason', `${p.name} querying LLM...`, { qid, agentIndex: agent.index });
  const verdict = await reason(p.systemPrompt, userPrompt);
  emit('agent:verdict', `${p.name} decided ${verdict.vote === 1 ? 'YES' : verdict.vote === 0 ? 'NO' : 'UNSURE'} @${verdict.confidence}`, {
    qid,
    agentIndex: agent.index,
    data: { vote: verdict.vote, confidence: verdict.confidence, reason: verdict.reason, model: verdict.model },
  });

  // 4. Encrypt
  emit('agent:encrypt', `${p.name} encrypting vote + confidence via CoFHE...`, { qid, agentIndex: agent.index });
  const client = await getCofheClient(agent.wallet);
  const { encVote, encConfidence } = await encryptVoteAndConfidence(client, verdict.vote, verdict.confidence);

  // 5. Hash reason
  const reasonHash = ethers.id(verdict.reason); // keccak256 of UTF-8 bytes

  // 6. Submit on-chain
  emit('agent:submit', `${p.name} submitting encrypted vote on-chain...`, { qid, agentIndex: agent.index });
  const tx = await submitVote(agent, qid, encVote, encConfidence, reasonHash);
  await waitTx(tx, 1);
  emit('agent:submitted', `${p.name} vote confirmed`, {
    qid,
    agentIndex: agent.index,
    data: { txHash: tx.hash, gasUsed: 'n/a' },
  });

  // 7. Persist
  const record: AgentVoteRecord = {
    agentIndex: agent.index,
    agentName: p.name,
    vote: verdict.vote,
    confidence: verdict.confidence,
    reason: verdict.reason,
    reasonHash,
    model: verdict.model,
    searchSnippet: searchSnippet.slice(0, 800),
    txHash: tx.hash,
    submittedAt: new Date().toISOString(),
  };
  setAgentVote(qid, record);

  return {
    agentIndex: agent.index,
    agentName: p.name,
    vote: verdict.vote,
    confidence: verdict.confidence,
    reason: verdict.reason,
    reasonHash,
    txHash: tx.hash,
    model: verdict.model,
  };
}

// Convenience wrapper used by orchestrator: run agents 0-3 in parallel,
// then agent 4 (Synthesis) with the others' verdicts.
export async function runAllAgents(
  qid: number
): Promise<AgentRunResult[]> {
  const firstFour = agents.slice(0, 4);
  const firstFourResults = await Promise.allSettled(
    firstFour.map((a) => runAgent(a, qid))
  );

  const succeeded: AgentRunResult[] = [];
  for (let i = 0; i < firstFourResults.length; i++) {
    const r = firstFourResults[i];
    if (r.status === 'fulfilled') {
      succeeded.push(r.value);
    } else {
      emit('agent:failed', `Agent ${i} (${agents[i].name}) failed: ${r.reason?.message ?? r.reason}`, {
        qid,
        agentIndex: i,
        data: { error: String(r.reason) },
      });
    }
  }

  // Synthesis Epsilon — gets the succeeded verdicts as context
  const synthesis = agents[4];
  try {
    const others: OtherAgentContext[] = succeeded.map((r) => ({
      name: r.agentName,
      vote: r.vote,
      confidence: r.confidence,
      reason: r.reason,
    }));
    const synthResult = await runAgent(synthesis, qid, others);
    succeeded.push(synthResult);
  } catch (e) {
    emit('agent:failed', `Agent 4 (${synthesis.name}) failed: ${(e as Error).message}`, {
      qid,
      agentIndex: 4,
      data: { error: String(e) },
    });
  }

  return succeeded;
}
