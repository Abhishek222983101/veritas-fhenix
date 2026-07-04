# VERITAS.FHENIX

Five AI agents vote on yes/no questions. Every vote is encrypted on the client with Fhenix CoFHE before it touches the chain. The contract tallies everything homomorphically. Only the final aggregate scores are ever decrypted. Individual votes stay encrypted forever.

**Live demo:** https://veritas-fhenix.vercel.app

**Contract on Arbitrum Sepolia:** [0xA214714b1e56adAa85D8359F300Bc1f3C09283e0](https://sepolia.arbiscan.io/address/0xA214714b1e56adAa85D8359F300Bc1f3C09283e0#code)

---

## Why this matters

A normal voting contract stores each vote in plaintext on chain. Anyone can read who voted what, which bribes, pressures, or copies voters.

VERITAS encrypts each vote with Fhenix CoFHE. The contract adds encrypted numbers together using fully homomorphic encryption. The contract never sees plaintext votes. Only the aggregate YES and NO scores get decrypted at the end.

**The bug that almost killed it:** every ciphertext must call `FHE.allowThis()` immediately after creation or no other contract function can read it. We hit this in week one. Fixed by wrapping every `FHE.asEuint8` in an allow call.

---

## How CoFHE is actually used

Surgical scope. We encrypt only two things per agent: the vote (YES/NO/UNSURE) and a confidence score. Nothing else is encrypted.

**Contract imports CoFHE directly:**
```solidity
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
```

**Per agent, the contract runs six FHE operations:**
1. `FHE.asEuint8(_encVote)` to deserialize the encrypted vote
2. `FHE.asEuint8(_encConfidence)` to deserialize the encrypted confidence
3. `FHE.eq(vote, YES_CONST)` to check if this is a YES vote (returns ebool)
4. `FHE.select(isYes, confidence, ZERO8)` to zero out confidence when not YES
5. `FHE.select(isNo, confidence, ZERO8)` to zero out confidence when not NO
6. Two `FHE.add` calls upcast to `euint16` accumulate into `yesScore` and `noScore`

Source: [contracts/src/VeritasOracle.sol lines 240 to 270](contracts/src/VeritasOracle.sol)

**No if/else on encrypted data.** Branching on ciphertext is impossible in FHE. We use `FHE.eq()` to produce an `ebool`, then `FHE.select()` to pick values conditionally without ever decrypting.

**Decryption flow (two transactions):**
1. Backend calls `allowPublic` on both score ciphertexts
2. Backend fetches the plaintext offchain via CoFHE SDK
3. Backend calls `publishDecryptResult` with the plaintext, contract emits it

Source: [contracts/src/VeritasOracle.sol lines 290 to 330](contracts/src/VeritasOracle.sol)

---

## Live proof on Arbitrum Sepolia

Question 1: "Will Bitcoin close above $200,000 on July 11, 2026?"

Five agents voted. Four voted NO. One voted YES. Individual votes were never decrypted. Only the final aggregate was published.

**Final aggregate (decrypted on chain):**
YES score = 75, NO score = 250, result = NO

**The decrypt and publish transaction (real, verifiable):**
[0x7d9cdba29fbb69dd1516f39d0857e0515198e5457b34d95ef5d53649ca113ea9](https://sepolia.arbiscan.io/tx/0x7d9cdba29fbb69dd1516f39d0857e0515198e5457b34d95ef5d53649ca113ea9)

**An example agent vote transaction (encrypted blob submitted on chain):**
[0x6dcad44c37d5cee5f7b48e66d46388d089ce9035d151cee63998067944562f89](https://sepolia.arbiscan.io/tx/0x6dcad44c37d5cee5f7b48e66d46388d089ce9035d151cee63998067944562f89)

Open it on Arbiscan. Notice the input data is a ciphertext blob. You cannot read the vote from it. That is the entire point.

---

## Architecture

```
Browser
   |
   v
Next.js (Vercel)  ----HTTP/SSE---->  Backend (Node.js)
                                        |
                                        |--- Tavily web search
                                        |--- Mistral / Groq LLM
                                        |--- CoFHE SDK encrypts vote
                                        |
                                        v
                                    VeritasOracle.sol (Arbitrum Sepolia)
                                        |
                                        v
                                    Fhenix CoFHE network handles FHE ops
```

**Three layers, three jobs:**

* Smart contract: stores encrypted votes, computes homomorphic tallies, publishes final result
* Backend: orchestrates 5 AI agents, encrypts their votes client side with CoFHE SDK, submits to chain, decrypts aggregate, publishes
* Frontend: shows the whole pipeline live, including the encrypted vote blobs and the final decrypted aggregate

---

## The 5 agents

| Name | Personality | What it does |
|---|---|---|
| Oracle Alpha | Conservative Bayesian | Weights base rates heavily |
| Skeptic Beta | Contrarian | Argues against consensus |
| Signal Gamma | Data driven | Reads the search results literally |
| Risk Delta | Risk averse | Flags tail risks, often votes UNSURE |
| Synthesis Epsilon | Balanced synthesizer | Sees the other 4 verdicts, then votes |

Synthesis Epsilon votes last on purpose. It is the only agent that sees the other encrypted verdict hashes before deciding. This creates a small hierarchy without breaking privacy.

---

## Run locally

Requirements: Node 20, Foundry 1.7+, git, an Arbitrum Sepolia RPC URL.

```bash
git clone https://github.com/Abhishek222983101/veritas-fhenix.git
cd veritas-fhenix

# Backend
cd backend
cp .env.example .env
# Fill in your keys (see .env.example)
npm install
npm run dev

# Frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

Frontend: http://localhost:3002
Backend API: http://localhost:3001

---

## Project structure

```
contracts/        Foundry project, VeritasOracle.sol, 14 passing tests
backend/          Node.js orchestrator, 5 agents, CoFHE SDK integration
frontend/         Next.js 16 brutalist UI, live SSE pipeline
shared/           ABI and deployed contract metadata
```

---

## Tech stack

* **Fhenix CoFHE** for fully homomorphic encryption (`@fhenixprotocol/cofhe-contracts@0.1.3`, `@cofhe/sdk@0.6.0`)
* **Arbitrum Sepolia** as the host chain
* **Solidity 0.8.25** with `via_ir` optimizer for contract size limits
* **Foundry 1.7** for tests and deployment
* **Next.js 16 + Tailwind 4** for the frontend
* **Mistral Large + Groq Llama 3.3 70B** for agent reasoning
* **Tavily** for web search
* **Vercel** for hosting the frontend

---

## Tests

**14 Foundry tests pass:** [contracts/test/VeritasOracle.t.sol](contracts/test/VeritasOracle.t.sol)

Covers full YES win resolution, full NO win resolution, single vote cases, UNSURE contributing zero, double vote rejection, non registered voter rejection, only owner agent registration, only backend publish, reputation updates.

Run them:
```bash
cd contracts
forge test
```

---

## Key files

| What | Where |
|---|---|
| Smart contract with FHE ops | [contracts/src/VeritasOracle.sol](contracts/src/VeritasOracle.sol) |
| CoFHE SDK client side encryption | [backend/src/cofhe.ts](backend/src/cofhe.ts) |
| Orchestrator loop | [backend/src/orchestrator.ts](backend/src/orchestrator.ts) |
| Agent pipeline (search, reason, encrypt, submit) | [backend/src/agents/agent.ts](backend/src/agents/agent.ts) |
| Live decrypt and publish flow | [backend/src/resolution/resolver.ts](backend/src/resolution/resolver.ts) |
| Live agent pipeline UI | [frontend/components/AgentPipeline.tsx](frontend/components/AgentPipeline.tsx) |
| Decrypted reveal UI | [frontend/components/ResolutionReveal.tsx](frontend/components/ResolutionReveal.tsx) |

---

## Real links (all verifiable)

* Live app: https://veritas-fhenix.vercel.app
* Verified contract source on Arbiscan: https://sepolia.arbiscan.io/address/0xA214714b1e56adAa85D8359F300Bc1f3C09283e0#code
* Decrypt publish tx: https://sepolia.arbiscan.io/tx/0x7d9cdba29fbb69dd1516f39d0857e0515198e5457b34d95ef5d53649ca113ea9
* Example encrypted vote tx: https://sepolia.arbiscan.io/tx/0x6dcad44c37d5cee5f7b48e66d46388d089ce9035d151cee63998067944562f89
* Fhenix CoFHE docs: https://docs.fhenix.zone/
* CoFHE contracts npm: https://www.npmjs.com/package/@fhenixprotocol/cofhe-contracts
* CoFHE SDK npm: https://www.npmjs.com/package/@cofhe/sdk

---

Built for the Fhenix CoFHE Hackathon 2026.
