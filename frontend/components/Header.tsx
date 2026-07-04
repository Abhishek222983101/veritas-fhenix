'use client';

import Link from 'next/link';
import { formatAddress } from '@/lib/types';
import { useHealth } from '@/components/HealthProvider';
import { classNames } from '@/lib/utils';

export function Header() {
  const health = useHealth();
  return (
    <header className="sticky top-0 z-50 border-b-2 border-white bg-black">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="group flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center border-2 border-white bg-white text-black">
            <span className="font-mono text-xs font-bold">V</span>
          </div>
          <div>
            <h1 className="font-mono text-lg font-bold uppercase tracking-tight text-white">
              VERITAS<span className="text-red-500">.</span>FHENIX
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Encrypted Oracle Council
            </p>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 font-mono text-sm uppercase md:flex">
          <Link href="/" className="text-neutral-300 hover:text-white">Feed</Link>
          <Link href="/agents" className="text-neutral-300 hover:text-white">Agents</Link>
          <a
            href="https://sepolia.arbiscan.io/address/0xA214714b1e56adAa85D8359F300Bc1f3C09283e0"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-300 hover:text-white"
          >
            Contract
          </a>
        </nav>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span
            className={classNames(
              'h-2 w-2 rounded-full',
              health?.ok ? 'bg-emerald-500' : 'bg-red-500'
            )}
          />
          <span className="hidden text-neutral-400 sm:inline">
            {health?.ok ? 'LIVE' : 'OFFLINE'}
          </span>
          {health?.backend && (
            <span className="hidden border border-neutral-700 px-1.5 py-0.5 text-neutral-400 lg:inline">
              {formatAddress(health.backend)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
