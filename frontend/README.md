# VERITAS-FHENIX Frontend

Brutalist Next.js frontend for the encrypted AI oracle council.

## Run locally

```bash
# 1. Start backend first (from ../backend)
cd ../backend
npm install
npm run dev

# 2. Start frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

Frontend: http://localhost:3002  
Backend API: http://localhost:3001

## E2E tests

```bash
npx playwright install chromium   # one-time
npm run test:e2e
```

## Pages

- `/` — question feed + submit form + live event stream
- `/question/[qid]` — encrypted votes, agent deliberation, decrypted result
- `/agents` — council roster with reputations

## Notes

- The frontend talks to the backend via Next.js rewrites (`/api/*` → `localhost:3001`).
- In production, set `NEXT_PUBLIC_API_BASE` or keep the rewrites pointed at your backend.
