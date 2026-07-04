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

## example : question 3

Live page: https://veritas-fhenix.vercel.app/question/3

Question asked: "will portgal win fifa worldcup ?"

This is a complete walkthrough of every step from question to decrypted result, with every transaction linked.

### Research pipeline (what each agent does)

Every agent runs the same 7 stage pipeline. The orchestrator dispatches 4 agents in parallel, then Synthesis Epsilon runs last and sees the other 4 verdict hashes before deciding.

1. **Query expansion** — the question is rewritten into 3 to 5 search friendly subqueries (Tavily search API)
2. **Web retrieval** — Tavily returns ranked snippets from betting sites, Wikipedia, Opta Analyst, news outlets
3. **Evidence extraction** — each snippet is parsed for numeric signals: odds, base rates, historical finishes, squad ratings
4. **Bayesian update** — the agent merges its prior (personality driven) with the evidence to form a posterior
5. **Verdict** — outputs YES, NO, or UNSURE plus a confidence between 0 and 99
6. **CoFHE encryption** — the backend takes the verdict and confidence and encrypts both with `@cofhe/sdk` before any chain call
7. **On chain submit** — `submitVote(qid, encVote, encConfidence)` is sent to VeritasOracle.sol

Source: [backend/src/agents/agent.ts](backend/src/agents/agent.ts) and [backend/src/cofhe.ts](backend/src/cofhe.ts)

### The 5 encrypted votes (all real, all on chain)

| Agent | Verdict | Confidence | ReasonHash | Encrypted vote tx on Arbiscan |
|---|---|---|---|---|
| Oracle Alpha | YES | 70 | 0x6e8c0fc7... | [0x2f0674c6...](https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486) |
| Skeptic Beta | NO | 85 | 0x110bc471... | [0xe56da5cb...](https://sepolia.arbiscan.io/tx/0xe56da5cb7e1f73b7e186b98293e66da95a86100433c5a26b3498d945baf1f208) |
| Signal Gamma | NO | 75 | 0x70908e4a... | [0xaed037b5...](https://sepolia.arbiscan.io/tx/0xaed037b5cf12d5d018c8c32defe5749992dc56fd86ab4b10638683e07647bd8b) |
| Risk Delta | UNSURE | 30 | 0xb0a27989... | [0xe4794293...](https://sepolia.arbiscan.io/tx/0xe47942935ffe5327da7fcbde2c6846db7decb309edde48e9a1ef6f0b5686c065) |
| Synthesis Epsilon | NO | 78 | 0x64fe86d9... | [0xffa5dd74...](https://sepolia.arbiscan.io/tx/0xffa5dd7417dc4706f66d280994a260a3476930530e406f87c1393461849e9c01) |

Open any of those transaction links. The input data is a ciphertext blob. You can see the sender (the agent wallet) and the target (the VeritasOracle contract), but you cannot read what the agent voted. That is CoFHE doing its job.

Agent wallets for reference (all 5 funded on Arbitrum Sepolia):
* Oracle Alpha: [0x3762c18E92Ab1582d69234908b00D48898ae3fC3](https://sepolia.arbiscan.io/address/0x3762c18E92Ab1582d69234908b00D48898ae3fC3)
* Skeptic Beta: [0x07d470c5089aD516c89FC86Ebab42871982cb3e6](https://sepolia.arbiscan.io/address/0x07d470c5089aD516c89FC86Ebab42871982cb3e6)
* Signal Gamma: [0x54Be9E53F2a5cAbF64Ee06D1B8bD1A73678b55F8](https://sepolia.arbiscan.io/address/0x54Be9E53F2a5cAbF64Ee06D1B8bD1A73678b55F8)
* Risk Delta: [0xA1840D3e49b2cEeB6028cF98369262B0bfe0c781](https://sepolia.arbiscan.io/address/0xA1840D3e49b2cEeB6028cF98369262B0bfe0c781)
* Synthesis Epsilon: [0x514c37EC2eC5e7fBf5d7d8d1895D80B531F365F9](https://sepolia.arbiscan.io/address/0x514c37EC2eC5e7fBf5d7d8d1895D80B531F365F9)

### What the contract computed while votes stayed encrypted

For each of the 5 votes, the contract ran this sequence inside `submitVote` (no decryption anywhere):

```solidity
euint8 vote = FHE.asEuint8(_encVote);            // load encrypted vote
euint8 confidence = FHE.asEuint8(_encConfidence); // load encrypted confidence
ebool isYes = FHE.eq(vote, YES_CONST);           // is this a YES?
ebool isNo  = FHE.eq(vote, NO_CONST);            // is this a NO?
euint8 yesContrib = FHE.select(isYes, confidence, ZERO8); // confidence if YES else 0
euint8 noContrib  = FHE.select(isNo,  confidence, ZERO8); // confidence if NO else 0
yesScore[qid] = FHE.add(yesScore[qid], FHE.asEuint16(yesContrib));
noScore[qid]  = FHE.add(noScore[qid],  FHE.asEuint16(noContrib));
```

That is 6 FHE operations per agent, 30 for the full question. Source: [VeritasOracle.sol submitVote function](contracts/src/VeritasOracle.sol)

### The decrypt and publish transaction

After all 5 votes are in, the backend triggers resolution. The contract calls `FHE.allowPublic` on both score ciphertexts. The backend fetches the plaintext via CoFHE SDK offchain, then publishes it on chain in one final transaction.

**The decrypt and publish tx for question 3:**
[0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2](https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2)

Final decrypted aggregate (written on chain by that tx):
* YES score = 70 (only Oracle Alpha contributed, confidence 70)
* NO score = 238 (Skeptic 85 + Signal 75 + Synthesis 78 = 238)
* Result = NO
* Risk Delta voted UNSURE so its confidence added to neither score

This matches the math: individual votes stayed encrypted the entire time, the contract did the addition homomorphically, and only the aggregate was revealed at the end.

### Reputation updates (transparent, written on chain by same tx)

| Agent | Delta | New reputation |
|---|---|---|
| Oracle Alpha (wrong) | -30 | 910 |
| Skeptic Beta (right) | +50 | 1150 |
| Signal Gamma (right) | +50 | 1150 |
| Risk Delta (UNSURE) | 0 | 1000 |
| Synthesis Epsilon (right) | +50 | 1150 |

Reputation deltas are transparent because they only depend on the aggregate result, not on individual votes. The contract never needed to decrypt a single vote to compute these.

### The full timeline

* Question submitted to chain at 14:33:44 UTC
* 4 agents started in parallel at 14:34:41 UTC (block 284068860)
* Oracle Alpha vote confirmed: [0x2f0674c6...](https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486)
* Skeptic Beta vote confirmed: [0xe56da5cb...](https://sepolia.arbiscan.io/tx/0xe56da5cb7e1f73b7e186b98293e66da95a86100433c5a26b3498d945baf1f208)
* Signal Gamma vote confirmed: [0xaed037b5...](https://sepolia.arbiscan.io/tx/0xaed037b5cf12d5d018c8c32defe5749992dc56fd86ab4b10638683e07647bd8b)
* Risk Delta vote confirmed: [0xe4794293...](https://sepolia.arbiscan.io/tx/0xe47942935ffe5327da7fcbde2c6846db7decb309edde48e9a1ef6f0b5686c065)
* Synthesis Epsilon (ran last, saw the other 4 hashes): [0xffa5dd74...](https://sepolia.arbiscan.io/tx/0xffa5dd7417dc4706f66d280994a260a3476930530e406f87c1393461849e9c01)
* Aggregate decrypted and published at 14:35:24 UTC: [0x4252ebc8...](https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2)

Total time from question to decrypted result: about 87 seconds.

Watch this exact flow live on the frontend: https://veritas-fhenix.vercel.app/question/3

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
