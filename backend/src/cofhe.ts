// CoFHE SDK wrapper for VERITAS-FHENIX backend.
//
// Provides:
//   - initCofhe(wallet): one client per signer (used to encrypt + decrypt)
//   - encryptVoteAndConfidence(client, vote, confidence): returns two EncryptedInput tuples
//   - decryptTally(client, ctHash): calls CoFHE /decrypt (withoutPermit — global allowance)
//
// CRITICAL CONVENTIONS (do not break):
//   1. Every encryptInputs() call returns tuples in input order — vote first, confidence second.
//   2. The SDK EncryptedItemInput {ctHash, securityZone, utype, signature} maps 1:1 to the
//      contract InEuint8 struct {uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature}.
//   3. FheTypes.Uint8 = 2 (per SDK enum).
//   4. Decrypt-after-allowPublic uses the global-allowance path (withoutPermit) because
//      triggerResolution() calls FHE.allowPublic on the tallies.
import { ethers } from 'ethers';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { Ethers6Adapter } from '@cofhe/sdk/adapters';
import { arbSepolia } from '@cofhe/sdk/chains';
import { Encryptable } from '@cofhe/sdk';
import type { CofheClient } from '@cofhe/sdk';
import { env } from './config.js';
import { EncryptedInput } from './contract.js';

// Cache: one client per wallet address (re-uses filesystem FHE key cache).
const clientCache = new Map<string, CofheClient>();

/**
 * Initialize (or fetch cached) CoFHE client bound to a specific wallet.
 * The wallet is used both to encrypt inputs AND to be the account context.
 */
export async function getCofheClient(wallet: ethers.Wallet): Promise<CofheClient> {
  const cached = clientCache.get(wallet.address);
  if (cached) return cached;

  const { publicClient, walletClient } = await Ethers6Adapter(wallet.provider as ethers.JsonRpcProvider, wallet);

  const config = createCofheConfig({
    environment: 'node',
    supportedChains: [arbSepolia],
  });

  const client = createCofheClient(config);
  await client.connect(publicClient, walletClient);

  if (!client.connected) {
    throw new Error(`CoFHE client failed to connect for ${wallet.address}`);
  }

  clientCache.set(wallet.address, client);
  return client;
}

export interface EncryptedVote {
  encVote: EncryptedInput;
  encConfidence: EncryptedInput;
}

/**
 * Encrypt the (vote, confidence) plaintext pair into two InEuint8 tuples.
 * The contract's submitVote(qid, InEuint8 encVote, InEuint8 encConfidence, reasonHash)
 * expects exactly these two tuples.
 *
 * @param client  CoFHE client bound to the agent's wallet
 * @param vote    0 (No) | 1 (Yes) | 2 (Unsure)
 * @param confidence  integer 1..100 (we cap to 0..255 for euint8)
 */
export async function encryptVoteAndConfidence(
  client: CofheClient,
  vote: number,
  confidence: number
): Promise<EncryptedVote> {
  if (![0, 1, 2].includes(vote)) throw new Error(`invalid vote ${vote}`);
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 255) {
    throw new Error(`invalid confidence ${confidence} (must be 0..255)`);
  }

  // Order is critical: [vote, confidence] — matches submitVote's expected arg order.
  const result = await client
    .encryptInputs([Encryptable.uint8(BigInt(vote)), Encryptable.uint8(BigInt(confidence))])
    .setChainId(env.CHAIN_ID)
    .execute();

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error(`encryptInputs returned unexpected shape (len=${(result as any)?.length})`);
  }

  const [encVoteRaw, encConfRaw] = result as any[];

  const encVote: EncryptedInput = normalizeItem(encVoteRaw, 'vote');
  const encConfidence: EncryptedInput = normalizeItem(encConfRaw, 'confidence');

  return { encVote, encConfidence };
}

function normalizeItem(raw: any, label: string): EncryptedInput {
  if (raw == null) throw new Error(`encryptInputs returned null for ${label}`);
  const { ctHash, securityZone, utype, signature } = raw;
  if (ctHash == null || securityZone == null || utype == null || signature == null) {
    throw new Error(`encryptInputs missing field on ${label}: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  // SDK returns ctHash as bigint; signature as `0x...` hex string.
  return {
    ctHash: BigInt(ctHash),
    securityZone: Number(securityZone),
    utype: Number(utype),
    signature: String(signature),
  };
}

export interface DecryptedTally {
  ctHash: bigint;
  decryptedValue: bigint;
  signature: string;
}

/**
 * Decrypt an on-chain euint16 tally (yesScore or noScore).
 *
 * REQUIRES the contract to have already called FHE.allowPublic(ctHash) on this tally
 * (i.e. triggerResolution() has been mined and the question is in Resolving status).
 *
 * Uses global-allowance path (withoutPermit) since allowPublic was used.
 */
export async function decryptTally(
  client: CofheClient,
  ctHash: bigint | string
): Promise<DecryptedTally> {
  const result = await client
    .decryptForTx(ctHash)
    .setChainId(env.CHAIN_ID)
    .withoutPermit()
    .execute();

  return {
    ctHash: BigInt(result.ctHash),
    decryptedValue: BigInt(result.decryptedValue),
    signature: result.signature,
  };
}
