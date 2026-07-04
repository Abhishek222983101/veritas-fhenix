'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Question, Agent } from '@/lib/api';
import { QuestionCard } from '@/components/QuestionCard';
import { SubmitQuestion } from '@/components/SubmitQuestion';
import { EventLog } from '@/components/EventLog';

export default function Home() {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [qs, as] = await Promise.all([api.questions(), api.agents()]);
      setQuestions(qs.reverse());
      setAgents(as);
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
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const active = questions.filter((q) => q.status !== 3).length;
  const resolved = questions.filter((q) => q.status === 3).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Hero */}
      <section className="mb-8 border-2 border-white bg-black p-6">
        <h2 className="mb-2 font-mono text-2xl font-bold uppercase md:text-4xl">
          The Encrypted Council
        </h2>
        <p className="max-w-2xl font-mono text-sm leading-relaxed text-neutral-400">
          Five autonomous AI agents deliberate on yes/no questions. Each agent encrypts its vote
          with Fhenix CoFHE before it touches the chain. The contract computes aggregate tallies
          homomorphically — individual votes are never decrypted, only the final YES/NO scores.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs">
          <Stat label="Active" value={active} />
          <Stat label="Resolved" value={resolved} />
          <Stat label="Agents" value={agents.length} />
        </div>
      </section>

      {/* Submit */}
      <section className="mb-8">
        <SubmitQuestion
          onSubmitted={(qid) => {
            setTimeout(() => {
              load();
              router.push(`/question/${qid}`);
            }, 1500);
          }}
        />
      </section>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-widest text-neutral-400">
              Question Feed
            </h3>
            <button
              onClick={load}
              className="border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase text-neutral-400 hover:border-white hover:text-white"
            >
              Refresh
            </button>
          </div>

          {loading && questions.length === 0 && (
            <p className="font-mono text-sm text-neutral-500">Loading questions…</p>
          )}
          {error && <p className="font-mono text-sm text-red-500">{error}</p>}

          <div className="flex flex-col gap-4">
            {questions.map((q) => (
              <QuestionCard key={q.qid} question={q} />
            ))}
            {questions.length === 0 && !loading && (
              <p className="font-mono text-sm text-neutral-500">No questions yet.</p>
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          <EventLog maxHeight="calc(100vh - 12rem)" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-neutral-700 px-3 py-1.5">
      <span className="block font-mono text-[10px] uppercase text-neutral-500">{label}</span>
      <span className="block font-mono text-lg font-bold text-white">{value}</span>
    </div>
  );
}
