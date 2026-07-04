'use client';

import { StatusLabel, StatusValue } from '@/lib/types';
import { statusColor, statusBg } from '@/lib/utils';

interface Props {
  status: StatusValue;
  animate?: boolean;
}

export function StatusBadge({ status, animate }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 border px-2 py-0.5 font-mono text-xs uppercase tracking-wider',
        statusColor[status],
        statusBg[status],
        animate && status === 1 ? 'animate-pulse' : '',
      ].join(' ')}
    >
      {status === 1 && (
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />
      )}
      {StatusLabel[status]}
    </span>
  );
}
