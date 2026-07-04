'use client';

import { VoteValue } from '@/lib/types';
import { voteColor, voteBorder, voteLabel } from '@/lib/utils';

interface Props {
  vote: VoteValue | number;
  confidence?: number;
  showConfidence?: boolean;
}

export function VoteBadge({ vote, confidence, showConfidence }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 border px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider',
        voteColor[vote as VoteValue],
        voteBorder[vote as VoteValue],
        'bg-black',
      ].join(' ')}
    >
      {voteLabel(vote)}
      {showConfidence && confidence !== undefined && (
        <span className="opacity-70">@{confidence}</span>
      )}
    </span>
  );
}
