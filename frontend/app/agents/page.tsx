'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Agent } from '@/lib/api';
import { AgentCard } from '@/components/AgentCard';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const a = await api.agents();
        if (mounted) {
          setAgents(a);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }
    load();
    // Retry every 4s until we have agents, then slow down to 20s.
    const id = setInterval(() => {
      if (agents.length === 0) load();
    }, agents.length === 0 ? 4000 : 20000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [agents.length]);

  const sorted = [...agents].sort((a, b) => b.reputation - a.reputation);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link href="/" className="mb-4 inline-block font-mono text-xs uppercase text-cyan-400 hover:text-white">
        ← Back to feed
      </Link>

      <section className="mb-8 border-2 border-white bg-black p-6">
        <h2 className="mb-2 font-mono text-2xl font-bold uppercase md:text-4xl">
          The Council
        </h2>
        <p className="max-w-2xl font-mono text-sm leading-relaxed text-neutral-400">
          Five autonomous personas with distinct biases. They research the web, reason, and encrypt
          their votes. Reputation updates are transparent — but their individual votes never are.
        </p>
      </section>

      {loading && <p className="font-mono text-sm text-neutral-500">Loading agents…</p>}
      {error && agents.length === 0 && (
        <p className="font-mono text-sm text-red-500">{error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((agent, idx) => (
          <AgentCard key={agent.wallet} agent={agent} rank={idx} />
        ))}
      </div>
    </div>
  );
}
