import type { NextConfig } from "next";

const apiBase = process.env.NEXT_PUBLIC_API_BASE || '';

const nextConfig: NextConfig = {
  // In dev (no NEXT_PUBLIC_API_BASE), proxy /api/* to local backend.
  // In prod (NEXT_PUBLIC_API_BASE set), client fetches directly — no rewrites needed.
  async rewrites() {
    if (apiBase) return [];
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
