# VERITAS.FHENIX

Five AI agents vote on yes/no questions. The twist: every single vote is encrypted with **Fhenix CoFHE** before it touches the chain, the contract tallies everything under fully homomorphic encryption, and only the final aggregate scores are ever decrypted. Individual votes stay encrypted forever.

This project is built entirely around CoFHE. The contract literally cannot tally a single vote without it.

**Live demo:** https://veritas-fhenix.vercel.app

---

## How CoFHE is used (the whole point)

CoFHE shows up in two places and both are required for this to work.

### 1. Smart contract side (FHE operations on chain)

The contract [VeritasOracle.sol](contracts/src/VeritasOracle.sol) imports CoFHE directly:

```solidity
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
```

For each agent that votes, the contract runs **six FHE operations** without ever decrypting anything:

```solidity
// Deserialize the encrypted inputs the client sent
euint8 vote       = FHE.asEuint8(_encVote);
euint8 confidence = FHE.asEuint8(_encConfidence);

// Homomorphic equality: is this vote a YES? is it a NO?
ebool isYes = FHE.eq(vote, YES_CONST);
ebool isNo  = FHE.eq(vote, NO_CONST);

// Encrypted mux: take confidence if matching, else zero
euint8 yesContrib = FHE.select(isYes, confidence, ZERO8);
euint8 noContrib  = FHE.select(isNo,  confidence, ZERO8);

// Homomorphic addition into running tallies
yesScore[_qid] = FHE.add(yesScore[_qid], FHE.asEuint16(yesContrib));
noScore[_qid]  = FHE.add(noScore[_qid],  FHE.asEuint16(noContrib));
```

For a full 5-agent question that is **30 FHE operations computed entirely on ciphertext**. No plaintext vote ever enters the contract.

The contract also uses CoFHE's permission system (`FHE.allowThis`) on every ciphertext it creates — without this no other contract function can read the value, which is the single most common CoFHE bug and we hit it and fixed it. Count of `allowThis` calls in the contract: 14.

Source: [contracts/src/VeritasOracle.sol](contracts/src/VeritasOracle.sol)

### 2. Client side (CoFHE SDK encryption + decryption)

The backend uses `@cofhe/sdk` to encrypt votes before they ever reach the chain. The contract never sees plaintext votes because the encryption happens on the client.

```typescript
import { Encryptable } from '@cofhe/sdk';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';

// Each agent's wallet gets its own CoFHE client
const client = createCofheClient(config);
await client.connect(publicClient, walletClient);

// Encrypt vote (0/1/2) and confidence (0..100) as euint8 ciphertexts
const result = await client
  .encryptInputs([
    Encryptable.uint8(BigInt(vote)),
    Encryptable.uint8(BigInt(confidence)),
  ])
  .setChainId(chainId)
  .execute();
// result is two {ctHash, securityZone, utype, signature} tuples
// that map 1:1 to the contract's InEuint8 struct
```

Source: [backend/src/cofhe.ts](backend/src/cofhe.ts)

### 3. The CoFHE decryption oracle flow (the endgame)

When voting is done, the contract calls `FHE.allowPublic` on both tallies. The backend then asks the CoFHE network to decrypt them offchain, and publishes the plaintext back on chain in a final transaction. The contract verifies the decryption signature via `FHE.publishDecryptResult`.

```solidity
// Contract side (triggerResolution)
FHE.allowPublic(yesScore[_qid]);
FHE.allowPublic(noScore[_qid]);

// Contract side (publishResult) — verifies CoFHE signatures
FHE.publishDecryptResult(yesScore[_qid], _yesVal, _yesSig);
FHE.publishDecryptResult(noScore[_qid],  _noVal,  _noSig);
```

```typescript
// Backend side — fetch plaintext from CoFHE network
const yesDecrypted = await client
  .decryptForTx(yesCtHash)
  .setChainId(chainId)
  .withoutPermit()   // global-allowance path because allowPublic was used
  .execute();
// yesDecrypted.decryptedValue is now the plaintext tally
```

This is the canonical CoFHE 2-tx decrypt pattern: allow on chain, decrypt offchain via SDK, publish back on chain.

Source: [backend/src/resolution/resolver.ts](backend/src/resolution/resolver.ts)

---

## CoFHE proof on chain (every link real and verifiable)

**CoFHE npm packages we actually depend on:**
* [`@fhenixprotocol/cofhe-contracts@0.1.3`](https://www.npmjs.com/package/@fhenixprotocol/cofhe-contracts) — Solidity FHE library imported by the contract
* [`@cofhe/sdk@0.6.0`](https://www.npmjs.com/package/@cofhe/sdk) — TypeScript SDK for client-side encryption and decryption

**Fhenix CoFHE documentation:** https://docs.fhenix.zone/

**Verified contract source showing all FHE ops:**
https://sepolia.arbiscan.io/address/0xA214714b1e56adAa85D8359F300Bc1f3C09283e0#code

**Encrypted vote transaction (the input data is a CoFHE ciphertext blob):**
https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486

Open that link. You can see who sent it and which contract received it, but you cannot read the vote. The input data is a CoFHE ciphertext. That is the entire point of this project.

**Decrypt and publish transaction (CoFHE decryption oracle flow):**
https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2

This transaction is the one that finally reveals YES=70, NO=238. Before this transaction, both scores existed only as ciphertexts on chain.

---

## example : question 3

Live page: https://veritas-fhenix.vercel.app/question/3

Question: "will portgal win fifa worldcup ?"

### What each agent did

Every agent runs a 7 stage pipeline. Four agents run in parallel, then Synthesis Epsilon runs last and sees the other four verdict hashes before deciding.

1. Query expansion into search-friendly subqueries
2. Web retrieval via Tavily search API
3. Evidence extraction (odds, base rates, historical finishes, squad data)
4. Bayesian update against the agent's personality prior
5. Verdict output: YES / NO / UNSURE plus confidence 0..99
6. CoFHE encryption of the verdict and confidence via `@cofhe/sdk`
7. On chain submit via `submitVote(qid, encVote, encConfidence)`

Source: [backend/src/agents/agent.ts](backend/src/agents/agent.ts)

### The 5 encrypted votes (all real, all on chain)

| Agent | Verdict | Confidence | Encrypted vote tx on Arbiscan |
|---|---|---|---|
| Oracle Alpha | YES | 70 | [0x2f0674c6...](https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486) |
| Skeptic Beta | NO | 85 | [0xe56da5cb...](https://sepolia.arbiscan.io/tx/0xe56da5cb7e1f73b7e186b98293e66da95a86100433c5a26b3498d945baf1f208) |
| Signal Gamma | NO | 75 | [0xaed037b5...](https://sepolia.arbiscan.io/tx/0xaed037b5cf12d5d018c8c32defe5749992dc56fd86ab4b10638683e07647bd8b) |
| Risk Delta | UNSURE | 30 | [0xe4794293...](https://sepolia.arbiscan.io/tx/0xe47942935ffe5327da7fcbde2c6846db7decb309edde48e9a1ef6f0b5686c065) |
| Synthesis Epsilon | NO | 78 | [0xffa5dd74...](https://sepolia.arbiscan.io/tx/0xffa5dd7417dc4706f66d280994a260a3476930530e406f87c1393461849e9c01) |

Each of those transactions carries a CoFHE ciphertext as its input data. The contract ran 6 FHE ops per vote (30 total) to fold each one into the encrypted tallies.

Agent wallets for reference:
* Oracle Alpha: [0x3762c18E92Ab1582d69234908b00D48898ae3fC3](https://sepolia.arbiscan.io/address/0x3762c18E92Ab1582d69234908b00D48898ae3fC3)
* Skeptic Beta: [0x07d470c5089aD516c89FC86Ebab42871982cb3e6](https://sepolia.arbiscan.io/address/0x07d470c5089aD516c89FC86Ebab42871982cb3e6)
* Signal Gamma: [0x54Be9E53F2a5cAbF64Ee06D1B8bD1A73678b55F8](https://sepolia.arbiscan.io/address/0x54Be9E53F2a5cAbF64Ee06D1B8bD1A73678b55F8)
* Risk Delta: [0xA1840D3e49b2cEeB6028cF98369262B0bfe0c781](https://sepolia.arbiscan.io/address/0xA1840D3e49b2cEeB6028cF98369262B0bfe0c781)
* Synthesis Epsilon: [0x514c37EC2eC5e7fBf5d7d8d1895D80B531F365F9](https://sepolia.arbiscan.io/address/0x514c37EC2eC5e7fBf5d7d8d1895D80B531F365F9)

### CoFHE decryption and result publishing

Once all 5 votes were in, the contract flipped to Resolving and called `FHE.allowPublic` on both tallies. The backend fetched the plaintext via CoFHE SDK and published it on chain in this transaction:

[0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2](https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2)

Final decrypted aggregate (written on chain by that tx via `FHE.publishDecryptResult`):
* YES score = 70 (only Oracle Alpha contributed, confidence 70)
* NO score = 238 (Skeptic 85 + Signal 75 + Synthesis 78 = 238)
* Risk Delta voted UNSURE so its confidence added to neither score
* Result = NO

The math works because the contract did the addition homomorphically. Nobody ever decrypted an individual vote.

### Reputation updates (transparent, written on chain)

| Agent | Delta | New reputation |
|---|---|---|
| Oracle Alpha (wrong) | -30 | 910 |
| Skeptic Beta (right) | +50 | 1150 |
| Signal Gamma (right) | +50 | 1150 |
| Risk Delta (UNSURE) | 0 | 1000 |
| Synthesis Epsilon (right) | +50 | 1150 |

Reputation deltas only need the aggregate result, never individual votes. The contract stayed encrypted the entire time and still updated reputations correctly.

### Timeline

* Question submitted at 14:33:44 UTC
* 4 agents started in parallel at 14:34:41 UTC (block 284068860)
* Oracle Alpha vote confirmed: [0x2f0674c6...](https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486)
* Skeptic Beta vote confirmed: [0xe56da5cb...](https://sepolia.arbiscan.io/tx/0xe56da5cb7e1f73b7e186b98293e66da95a86100433c5a26b3498d945baf1f208)
* Signal Gamma vote confirmed: [0xaed037b5...](https://sepolia.arbiscan.io/tx/0xaed037b5cf12d5d018c8c32defe5749992dc56fd86ab4b10638683e07647bd8b)
* Risk Delta vote confirmed: [0xe4794293...](https://sepolia.arbiscan.io/tx/0xe47942935ffe5327da7fcbde2c6846db7decb309edde48e9a1ef6f0b5686c065)
* Synthesis Epsilon (ran last, saw the other 4 hashes): [0xffa5dd74...](https://sepolia.arbiscan.io/tx/0xffa5dd7417dc4706f66d280994a260a3476930530e406f87c1393461849e9c01)
* CoFHE decrypt and publish at 14:35:24 UTC: [0x4252ebc8...](https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2)

Total time from question to decrypted result: about 87 seconds.

Watch this exact flow live: https://veritas-fhenix.vercel.app/question/3

---

## Why CoFHE matters here

A normal voting contract stores each vote as plaintext on chain. Anyone can read who voted what, which enables bribery, pressure, and copy trading.

VERITAS encrypts each vote with CoFHE before submission. The contract adds encrypted numbers using fully homomorphic encryption. The contract never sees plaintext votes. Only the final YES and NO aggregates are revealed at the end via the CoFHE decryption oracle.

The interesting CoFHE gotcha we hit and fixed: every ciphertext must call `FHE.allowThis()` immediately after creation, or no other contract function can read it. We hit this bug in week one. The contract now has 14 `allowThis` calls in the right places.

---

## The 5 agents

| Name | Personality | What it does |
|---|---|---|
| Oracle Alpha | Conservative Bayesian | Weights base rates heavily |
| Skeptic Beta | Contrarian | Argues against consensus |
| Signal Gamma | Data driven | Reads the search results literally |
| Risk Delta | Risk averse | Flags tail risks, often votes UNSURE |
| Synthesis Epsilon | Balanced synthesizer | Sees the other 4 verdicts, then votes |

Synthesis Epsilon votes last on purpose. It is the only agent that sees the other 4 verdict hashes before deciding. This creates a small hierarchy without breaking privacy.

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
                                        |--- @cofhe/sdk encrypts vote client-side
                                        |
                                        v
                                    VeritasOracle.sol (imports @fhenixprotocol/cofhe-contracts)
                                        |
                                        v
                                    Fhenix CoFHE network handles FHE ops + decryption oracle
```

**Three layers, three jobs:**

* Smart contract: stores CoFHE ciphertexts, computes homomorphic tallies via `FHE.add`, publishes final result via `FHE.publishDecryptResult`
* Backend: orchestrates 5 AI agents, encrypts votes client-side via `@cofhe/sdk`, submits to chain, decrypts aggregate via CoFHE SDK, publishes
* Frontend: shows the entire pipeline live including the encrypted vote blobs and the final decrypted aggregate

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
backend/          Node.js orchestrator, 5 agents, @cofhe/sdk integration
frontend/         Next.js 16 brutalist UI, live SSE pipeline
shared/           ABI and deployed contract metadata
```

---

## Tech stack

* **Fhenix CoFHE** for fully homomorphic encryption (`@fhenixprotocol/cofhe-contracts@0.1.3`, `@cofhe/sdk@0.6.0`)
* **Solidity 0.8.25** with `via_ir` optimizer (contract was hitting the 24KB limit without it)
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
| Smart contract with all FHE ops | [contracts/src/VeritasOracle.sol](contracts/src/VeritasOracle.sol) |
| CoFHE SDK client-side encryption | [backend/src/cofhe.ts](backend/src/cofhe.ts) |
| CoFHE decryption oracle flow | [backend/src/resolution/resolver.ts](backend/src/resolution/resolver.ts) |
| Orchestrator loop | [backend/src/orchestrator.ts](backend/src/orchestrator.ts) |
| Agent pipeline (search, reason, encrypt, submit) | [backend/src/agents/agent.ts](backend/src/agents/agent.ts) |
| Live agent pipeline UI | [frontend/components/AgentPipeline.tsx](frontend/components/AgentPipeline.tsx) |
| Decrypted reveal UI | [frontend/components/ResolutionReveal.tsx](frontend/components/ResolutionReveal.tsx) |

---

## Real verifiable links

* Live app: https://veritas-fhenix.vercel.app
* Live case study: https://veritas-fhenix.vercel.app/question/3
* Verified contract source (shows every FHE op): https://sepolia.arbiscan.io/address/0xA214714b1e56adAa85D8359F300Bc1f3C09283e0#code
* CoFHE decrypt and publish tx: https://sepolia.arbiscan.io/tx/0x4252ebc8ad3716fa869ae7cbb3168ad4c1b90cbc2b90f020612a6f42bfd87fc2
* Example encrypted vote tx (ciphertext blob): https://sepolia.arbiscan.io/tx/0x2f0674c637073ced5ae764f44acb894f3a4a944ffcc2261faeebfe52fc6dd486
* Fhenix CoFHE docs: https://docs.fhenix.zone/
* CoFHE contracts on npm: https://www.npmjs.com/package/@fhenixprotocol/cofhe-contracts
* CoFHE SDK on npm: https://www.npmjs.com/package/@cofhe/sdk

---

Built for the Fhenix CoFHE Hackathon 2026.
