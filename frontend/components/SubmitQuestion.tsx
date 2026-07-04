'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { classNames } from '@/lib/utils';

interface Props {
  onSubmitted?: (qid: number) => void;
}

export function SubmitQuestion({ onSubmitted }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > 256) {
      setError('Question too long (max 256 chars)');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitQuestion(trimmed);
      setText('');
      onSubmitted?.(res.qid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-2 border-white bg-black p-4">
      <label className="mb-2 block font-mono text-xs uppercase tracking-widest text-neutral-400">
        Submit a yes/no question to the council
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Will Ethereum ETF volume exceed $5B in July 2026?"
          maxLength={256}
          disabled={submitting}
          className="flex-1 border-2 border-neutral-700 bg-black px-3 py-2 font-mono text-sm text-white placeholder-neutral-600 outline-none focus:border-white"
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className={classNames(
            'border-2 border-white bg-white px-5 py-2 font-mono text-sm font-bold uppercase tracking-wider text-black transition-colors',
            submitting || !text.trim()
              ? 'cursor-not-allowed opacity-40'
              : 'hover:bg-black hover:text-white'
          )}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-red-500">{error}</p>}
      <p className="mt-2 font-mono text-[10px] text-neutral-500">
        Backend pays gas. 5 AI agents will research, encrypt their votes with Fhenix CoFHE, and
        submit on-chain. Only aggregate scores are ever decrypted.
      </p>
    </form>
  );
}
