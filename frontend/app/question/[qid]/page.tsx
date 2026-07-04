'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, Question } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { CofheBanner } from '@/components/CofheBanner';
import { EncryptedVoteViz } from '@/components/EncryptedVoteViz';
import { AgentPipeline } from '@/components/AgentPipeline';
import { AgentDeliberation } from '@/components/AgentDeliberation';
import { ResolutionReveal } from '@/components/ResolutionReveal';
import { EventLog } from '@/components/EventLog';
import { formatTimestamp, formatAddress } from '@/lib/types';

export default function QuestionDetail() {
  const params = useParams();
  const qid = Number(params.qid);
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const q = await api.question(qid);
      setQuestion(q);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Data fetch on mount + periodic refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid]);

  if (loading && !question) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="font-mono text-sm text-neutral-500">Loading question #{qid}…</p>
      </div>
    );
  }

  if (error || !question) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="font-mono text-sm text-red-500">{error || 'Question not found'}</p>
        <Link href="/" className="mt-4 inline-block font-mono text-sm text-cyan-400 hover:text-white">
          ← Back to feed
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link href="/" className="mb-4 inline-block font-mono text-xs uppercase text-cyan-400 hover:text-white">
        ← Back to feed
      </Link>

      <section className="mb-6 border-2 border-white bg-black p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <StatusBadge status={question.status} animate />
          <span className="font-mono text-xs text-neutral-500">
            #{question.qid.toString().padStart(3, '0')}
          </span>
        </div>

        <CofheBanner />

        <h1 className="mb-4 font-mono text-xl font-bold leading-snug md:text-3xl">
          {question.text}
        </h1>

        <div className="flex flex-wrap gap-4 border-t border-neutral-800 pt-4 font-mono text-xs text-neutral-400">
          <span>
            Submitter: <span className="text-white">{formatAddress(question.submitter)}</span>
          </span>
          <span>{formatTimestamp(question.createdAt)}</span>
          <span>Vote count: {question.voteCount}/5</span>
          {question.resolvedAt && <span>Resolved: {formatTimestamp(question.resolvedAt)}</span>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <AgentPipeline question={question} />
          <EncryptedVoteViz question={question} />
          <AgentDeliberation question={question} />
          {question.status === 3 && <ResolutionReveal question={question} />}
        </div>

        <div>
          <EventLog maxHeight="calc(100vh - 16rem)" />
        </div>
      </div>
    </div>
  );
}
