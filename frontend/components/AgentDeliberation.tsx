'use client';

import { Question, AgentVoteRecord } from '@/lib/types';
import { VoteBadge } from './VoteBadge';
import { formatTimestamp } from '@/lib/types';
import { useFilteredEvents } from '@/lib/sse';

interface Props {
  question: Question;
}

export function AgentDeliberation({ question }: Props) {
  const { events } = useFilteredEvents(question.qid);
  const votes = question.votes || [];

  return (
    <div className="border-2 border-neutral-700 bg-black p-4">
      <h3 className="mb-4 font-mono text-xs uppercase tracking-widest text-neutral-400">
        Agent Deliberation Log
      </h3>

      <div className="flex flex-col gap-4">
        {[0, 1, 2, 3, 4].map((idx) => {
          const vote = votes.find((v) => v.agentIndex === idx);
          return (
            <AgentTimeline
              key={idx}
              agentIndex={idx}
              vote={vote}
              events={events.filter((e) => e.agentIndex === idx)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AgentTimeline({
  agentIndex,
  vote,
  events,
}: {
  agentIndex: number;
  vote?: AgentVoteRecord;
  events: { type: string; message: string; ts: string }[];
}) {
  const names = ['Oracle Alpha', 'Skeptic Beta', 'Signal Gamma', 'Risk Delta', 'Synthesis Epsilon'];
  const name = vote?.agentName || names[agentIndex];

  return (
    <div className="border border-neutral-800 bg-neutral-900/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-white">{name}</span>
        {vote ? (
          <VoteBadge vote={vote.vote} confidence={vote.confidence} showConfidence />
        ) : (
          <span className="font-mono text-[10px] text-yellow-400 animate-pulse">DELIBERATING…</span>
        )}
      </div>

      {vote?.reason && (
        <p className="mb-2 font-mono text-xs leading-relaxed text-neutral-300">
          “{vote.reason}”
        </p>
      )}

      {events.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-2 font-mono text-[10px]">
              <span className="text-neutral-600">{formatTimestamp(ev.ts)}</span>
              <span className="text-cyan-400">{ev.type.replace('agent:', '')}</span>
              <span className="text-neutral-400">{ev.message}</span>
            </div>
          ))}
        </div>
      ) : vote?.submittedAt ? (
        <p className="border-t border-neutral-800 pt-2 font-mono text-[10px] text-emerald-400">
          ✓ Vote encrypted with CoFHE and submitted on-chain at {formatTimestamp(vote.submittedAt)}
        </p>
      ) : (
        <p className="font-mono text-[10px] text-neutral-600">waiting to start…</p>
      )}
    </div>
  );
}
