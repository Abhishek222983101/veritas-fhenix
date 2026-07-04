'use client';

import { Agent } from '@/lib/types';
import { formatAddress } from '@/lib/types';
import { agentGradient, classNames } from '@/lib/utils';

interface Props {
  agent: Agent;
  rank: number;
}

export function AgentCard({ agent, rank }: Props) {
  return (
    <div
      className={classNames(
        'relative border-2 border-neutral-700 bg-black p-4 transition-colors hover:border-white',
        `bg-gradient-to-br ${agentGradient(rank)}`
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-mono text-lg font-bold text-white">{agent.name}</h3>
          <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            {formatAddress(agent.wallet)}
          </p>
        </div>
        <div className="border border-white px-2 py-1 text-right">
          <span className="block font-mono text-[10px] uppercase text-neutral-400">Rep</span>
          <span className="block font-mono text-lg font-bold text-white">{agent.reputation}</span>
        </div>
      </div>

      <p className="mb-3 font-mono text-sm leading-relaxed text-neutral-300">
        {agent.personality}
      </p>

      <div className="flex items-center gap-3 border-t border-neutral-800 pt-3 font-mono text-[10px] uppercase tracking-wider">
        <span
          className={classNames(
            'px-1.5 py-0.5',
            agent.isActive ? 'text-emerald-400' : 'text-red-500'
          )}
        >
          {agent.isActive ? 'Active' : 'Inactive'}
        </span>
        <a
          href={`https://sepolia.arbiscan.io/address/${agent.wallet}`}
          target="_blank"
          rel="noreferrer"
          className="text-neutral-500 hover:text-white"
        >
          Arbiscan →
        </a>
      </div>
    </div>
  );
}
