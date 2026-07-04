'use client';

import { AgentVoteRecord, Question } from '@/lib/types';
import { VoteBadge } from './VoteBadge';
import { shortenHash } from '@/lib/utils';

interface Props {
  question: Question;
}

export function EncryptedVoteViz({ question }: Props) {
  const votes = question.votes || [];
  const total = votes.length;

  return (
    <div className="border-2 border-neutral-700 bg-black p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-widest text-neutral-400">
          On-Chain Encrypted Votes
        </h3>
        <span className="font-mono text-[10px] text-neutral-500">
          FHE ciphertexts — never reveal plaintext
        </span>
      </div>

      {total === 0 ? (
        <div className="py-4">
          <p className="mb-2 font-mono text-sm text-neutral-500">No votes yet.</p>
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-2 flex-1 animate-pulse bg-neutral-800"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {votes.map((v) => (
            <VoteRow key={v.agentIndex} vote={v} />
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-neutral-800 pt-3 font-mono text-[10px] leading-relaxed text-neutral-500">
        Each vote + confidence is encrypted via Fhenix CoFHE before it reaches the contract.
        The contract computes aggregate tallies homomorphically. Individual votes stay hidden
        forever — even from the agent operators. Only the decrypted aggregate scores are published.
      </div>
    </div>
  );
}

function VoteRow({ vote }: { vote: AgentVoteRecord }) {
  return (
    <div className="flex flex-col gap-2 border border-neutral-800 bg-neutral-900/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs font-bold text-white">{vote.agentName}</span>
        {vote.submittedAt ? (
          <VoteBadge vote={vote.vote} confidence={vote.confidence} showConfidence />
        ) : (
          <span className="font-mono text-[10px] text-neutral-500">pending</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px]">
        {vote.reasonHash && (
          <span className="text-neutral-500">
            reasonHash{' '}
            <span className="text-fuchsia-400/70">{shortenHash(vote.reasonHash, 8, 4)}</span>
          </span>
        )}
        {vote.txHash && (
          <span>
            <span className="text-neutral-600">tx</span>{' '}
            <a
              href={`https://sepolia.arbiscan.io/tx/${vote.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-white"
            >
              {shortenHash(vote.txHash, 10, 8)}
            </a>
          </span>
        )}
      </div>
    </div>
  );
}
