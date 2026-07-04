'use client';

import { Question } from '@/lib/types';
import { VoteBadge } from './VoteBadge';
import { formatTimestamp } from '@/lib/types';

interface Props {
  question: Question;
}

export function ResolutionReveal({ question }: Props) {
  const res = question.resolution;
  if (!res || question.status !== 3) return null;

  const total = res.yesScore + res.noScore;
  const yesPct = total > 0 ? (res.yesScore / total) * 100 : 0;
  const noPct = total > 0 ? (res.noScore / total) * 100 : 0;

  return (
    <div className="relative overflow-hidden border-2 border-white bg-black p-5">
      <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.03)_10px,rgba(255,255,255,0.03)_20px)]" />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-widest text-neutral-400">
            Decrypted Aggregate Result
          </h3>
          <VoteBadge vote={res.result} />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <ScoreCard label="YES" value={res.yesScore} pct={yesPct} color="emerald" />
          <ScoreCard label="NO" value={res.noScore} pct={noPct} color="rose" />
        </div>

        <div className="mb-4 h-4 w-full border border-white bg-black">
          <div className="flex h-full">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${yesPct}%` }}
            />
            <div
              className="h-full bg-rose-500"
              style={{ width: `${noPct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] text-neutral-500">
          <span>Resolved {formatTimestamp(res.resolvedAt)}</span>
          {res.publishTxHash && (
            <a
              href={`https://sepolia.arbiscan.io/tx/${res.publishTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-white"
            >
              Publish tx →
            </a>
          )}
        </div>

        {res.reputationDeltas && res.reputationDeltas.length > 0 && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-neutral-400">
              Reputation Updates
            </h4>
            <div className="flex flex-wrap gap-2">
              {res.reputationDeltas.map((d, i) => (
                <span
                  key={i}
                  className={[
                    'border px-2 py-1 font-mono text-[10px]',
                    d.delta > 0
                      ? 'border-emerald-500 text-emerald-400'
                      : d.delta < 0
                        ? 'border-rose-500 text-rose-400'
                        : 'border-neutral-600 text-neutral-400',
                  ].join(' ')}
                >
                  {formatAddress(d.agent)} {d.delta > 0 ? '+' : ''}
                  {d.delta} → {d.newReputation}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: number;
  pct: number;
  color: 'emerald' | 'rose';
}) {
  return (
    <div className={`border-2 ${color === 'emerald' ? 'border-emerald-500' : 'border-rose-500'} bg-black p-3`}>
      <span className="block font-mono text-[10px] uppercase text-neutral-400">{label} score</span>
      <span className={`block font-mono text-3xl font-bold ${color === 'emerald' ? 'text-emerald-500' : 'text-rose-500'}`}>
        {value}
      </span>
      <span className="block font-mono text-xs text-neutral-500">{pct.toFixed(1)}%</span>
    </div>
  );
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
