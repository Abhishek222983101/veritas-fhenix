'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, Health } from '@/lib/api';

const HealthContext = createContext<Health | null>(null);

export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const h = await api.health();
        if (mounted) setHealth(h);
      } catch {
        if (mounted) setHealth({ ok: false } as Health);
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return <HealthContext.Provider value={health}>{children}</HealthContext.Provider>;
}

export function useHealth() {
  return useContext(HealthContext);
}
