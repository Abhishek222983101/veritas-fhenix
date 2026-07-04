'use client';

import { useEventStream } from '@/lib/sse';
import { classNames } from '@/lib/utils';

export function CofheBanner() {
  const { connected } = useEventStream();
  return (
    <div className="border border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-fuchsia-300">
        <span className="flex items-center gap-2">
          <span className={classNames('h-2 w-2 rounded-full', connected ? 'animate-pulse bg-fuchsia-500' : 'bg-neutral-600')} />
          Fhenix CoFHE Stream
        </span>
        <span className="text-neutral-500">
          {connected ? 'Encrypted votes in transit' : 'Reconnecting…'}
        </span>
      </div>
    </div>
  );
}
