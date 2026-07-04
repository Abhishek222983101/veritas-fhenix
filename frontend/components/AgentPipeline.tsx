'use client';

import { AgentVoteRecord, Question, SseEvent } from '@/lib/types';
import { VoteBadge } from './VoteBadge';
import { useFilteredEvents } from '@/lib/sse';
import { formatTimestamp } from '@/lib/types';
import { shortenHash } from '@/lib/utils';

const STAGES = [
  { key: 'start', label: 'RESEARCH', color: 'border-cyan-500 text-cyan-400' },
  { key: 'search', label: 'SEARCH', color: 'border-blue-500 text-blue-400' },
  { key: 'reason', label: 'REASON', color: 'border-violet-500 text-violet-400' },
  { key: 'verdict', label: 'DECIDE', color: 'border-amber-500 text-amber-400' },
  { key: 'encrypt', label: 'ENCRYPT (CoFHE)', color: 'border-fuchsia-500 text-fuchsia-400' },
  { key: 'submit', label: 'SUBMIT', color: 'border-orange-500 text-orange-400' },
  { key: 'submitted', label: 'CONFIRMED', color: 'border-emerald-500 text-emerald-400' },
];

interface Props {
  question: Question;
}

export function AgentPipeline({ question }: Props) {
  const { events } = useFilteredEvents(question.qid);
  const votes = question.votes || [];

  return (
    <div className="border-2 border-neutral-700 bg-black p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-widest text-neutral-400">
          Live Agent Pipeline
        </h3>
        <span className="font-mono text-[10px] text-neutral-500">
          CoFHE encryption happens client-side before each vote reaches the chain
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((idx) => (
          <AgentColumn
            key={idx}
            agentIndex={idx}
            vote={votes.find((v) => v.agentIndex === idx)}
            events={events.filter((e) => e.agentIndex === idx)}
          />
        ))}
      </div>
    </div>
  );
}

function AgentColumn({
  agentIndex,
  vote,
  events,
}: {
  agentIndex: number;
  vote?: AgentVoteRecord;
  events: SseEvent[];
}) {
  const names = ['Oracle Alpha', 'Skeptic Beta', 'Signal Gamma', 'Risk Delta', 'Synthesis Epsilon'];
  const name = vote?.agentName || names[agentIndex];
  const currentStage = getCurrentStage(events, vote);

  return (
    <div className="flex flex-col gap-2 border border-neutral-800 bg-neutral-900/30 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-white">{name}</span>
        {vote ? (
          <VoteBadge vote={vote.vote} confidence={vote.confidence} showConfidence />
        ) : (
          <span className="animate-pulse font-mono text-[10px] text-yellow-400">LIVE</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {STAGES.map((stage, idx) => {
          const isActive = currentStage === stage.key;
          const isDone = stageIndex(currentStage) > idx;
          return (
            <div
              key={stage.key}
              className={[
                'border px-1.5 py-1 font-mono text-[10px] uppercase transition-all',
                isActive
                  ? `${stage.color} bg-black animate-pulse`
                  : isDone
                    ? 'border-neutral-700 text-neutral-500 bg-black'
                    : 'border-neutral-800 text-neutral-700 bg-black',
              ].join(' ')}
            >
              <span className="mr-1">
                {isDone ? '✓' : isActive ? '●' : '○'}
              </span>
              {stage.label}
            </div>
          );
        })}
      </div>

      {vote?.reason && (
        <p className="mt-1 border-t border-neutral-800 pt-2 font-mono text-[10px] leading-relaxed text-neutral-400">
          “{truncate(vote.reason, 90)}”
        </p>
      )}

      {vote?.txHash && (
        <div className="mt-1 font-mono text-[9px] text-neutral-500">
          <span className="text-neutral-600">tx</span>{' '}
          <a
            href={`https://sepolia.arbiscan.io/tx/${vote.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 hover:text-white"
          >
            {shortenHash(vote.txHash, 8, 4)}
          </a>
        </div>
      )}

      {vote?.submittedAt && (
        <p className="font-mono text-[9px] text-neutral-600">
          {formatTimestamp(vote.submittedAt)}
        </p>
      )}
    </div>
  );
}

function getCurrentStage(events: SseEvent[], vote?: AgentVoteRecord): string {
  if (vote?.txHash) return 'submitted';
  if (events.length === 0) return 'start';
  const latest = events[events.length - 1].type;
  if (latest.startsWith('agent:')) {
    const step = latest.replace('agent:', '');
    if (STAGES.some((s) => s.key === step)) return step;
  }
  return 'start';
}

function stageIndex(stage: string): number {
  return STAGES.findIndex((s) => s.key === stage);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
