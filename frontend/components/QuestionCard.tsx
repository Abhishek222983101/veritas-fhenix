'use client';

import Link from 'next/link';
import { Question } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { VoteBadge } from './VoteBadge';
import { formatTimestamp } from '@/lib/types';
import { statusBg } from '@/lib/utils';

interface Props {
  question: Question;
}

export function QuestionCard({ question }: Props) {
  const isResolved = question.status === 3;

  return (
    <Link href={`/question/${question.qid}`}>
      <article
        className={[
          'group relative border-2 border-neutral-700 bg-black p-4 transition-colors hover:border-white',
          statusBg[question.status],
        ].join(' ')}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <StatusBadge status={question.status} animate />
          <span className="font-mono text-[10px] text-neutral-500">
            #{question.qid.toString().padStart(3, '0')}
          </span>
        </div>

        <h2 className="mb-4 font-mono text-base font-bold leading-snug text-white group-hover:underline">
          {question.text}
        </h2>

        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-3 font-mono text-xs">
          <span className="text-neutral-400">{question.voteCount}/5 votes</span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-500">{formatTimestamp(question.createdAt)}</span>
          {isResolved && (
            <>
              <span className="text-neutral-600">|</span>
              <VoteBadge vote={question.result} />
              <span className="text-neutral-400">
                YES {question.yesScorePlain} · NO {question.noScorePlain}
              </span>
            </>
          )}
        </div>
      </article>
    </Link>
  );
}
