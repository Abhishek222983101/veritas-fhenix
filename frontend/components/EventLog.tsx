'use client';

import { useEventStream } from '@/lib/sse';
import { formatTimestamp } from '@/lib/types';

const typeColor: Record<string, string> = {
  'api:start': 'text-emerald-400',
  'orchestrator:start': 'text-emerald-400',
  'question:discovered': 'text-cyan-400',
  'question:voting': 'text-cyan-400',
  'question:submitted': 'text-cyan-400',
  'question:incomplete': 'text-amber-400',
  'agent:start': 'text-yellow-400',
  'agent:search': 'text-blue-400',
  'agent:reason': 'text-violet-400',
  'agent:verdict': 'text-amber-400',
  'agent:encrypt': 'text-fuchsia-400',
  'agent:submit': 'text-orange-400',
  'agent:submitted': 'text-emerald-400',
  'agent:failed': 'text-red-500',
  'resolve:start': 'text-purple-400',
  'resolve:trigger': 'text-purple-400',
  'resolve:triggered': 'text-purple-400',
  'resolve:decrypt': 'text-pink-400',
  'resolve:decrypted': 'text-pink-400',
  'resolve:publish': 'text-pink-400',
  'resolve:published': 'text-emerald-400',
  'resolve:reputation': 'text-emerald-400',
  'resolve:reputationUpdated': 'text-emerald-400',
  'resolve:done': 'text-emerald-400',
  'orchestrator:error': 'text-red-500',
  'question:error': 'text-red-500',
  'resolve:error': 'text-red-500',
};

interface Props {
  compact?: boolean;
  maxHeight?: string;
}

export function EventLog({ compact, maxHeight = '24rem' }: Props) {
  const { events, connected } = useEventStream();
  const visible = compact ? events.slice(-12) : events;

  return (
    <div className="flex h-full flex-col border-2 border-neutral-700 bg-black">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-widest text-neutral-400">
          Live Event Stream
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase">
          <span className={connected ? 'text-emerald-500' : 'text-red-500'}>
            {connected ? '● SSE' : '○ SSE'}
          </span>
          <span className="text-neutral-600">{events.length} events</span>
        </span>
      </div>
      <div
        className="flex-1 overflow-y-auto p-3 font-mono text-xs"
        style={{ maxHeight }}
      >
        {visible.length === 0 && (
          <p className="text-neutral-600">Waiting for events…</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {visible.map((ev) => (
            <li key={ev.id} className="break-words">
              <span className="text-neutral-600">[{formatTimestamp(ev.ts)}]</span>{' '}
              <span className={typeColor[ev.type] || 'text-neutral-300'}>
                {ev.type.toUpperCase()}
              </span>{' '}
              {ev.qid !== undefined && (
                <span className="text-neutral-500">#{ev.qid}</span>
              )}{' '}
              <span className="text-neutral-300">{ev.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
