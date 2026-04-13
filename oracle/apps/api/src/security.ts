/**
 * Security utilities: vote signature verification, admin auth, replay protection,
 * canonical JSON hashing, and error sanitization.
 */

import { verifyMessage, type Address, type Hex } from "viem";
import type { Request, Response, NextFunction } from "express";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const REQUIRE_VOTE_SIGNATURE =
  (process.env.REQUIRE_VOTE_SIGNATURE || "auto").toLowerCase();

const SIGNATURE_TTL_MS = 5 * 60 * 1000;
const NONCE_CACHE_LIMIT = 5000;
const seenNonces = new Map<string, number>();

function pruneNonces() {
  if (seenNonces.size <= NONCE_CACHE_LIMIT) return;
  const now = Date.now();
  for (const [key, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(key);
    if (seenNonces.size <= NONCE_CACHE_LIMIT) break;
  }
}

export function buildVoteMessage(params: {
  proposalId: string;
  choice: string;
  voter: string;
  nonce: string;
  timestamp: number;
}): string {
  const { proposalId, choice, voter, nonce, timestamp } = params;
  return [
    "BRIDGE Oracle Vote",
    `Proposal: ${proposalId}`,
    `Voter: ${voter.toLowerCase()}`,
    `Choice: ${choice.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

export interface VoteSignatureInput {
  voter: Address;
  proposalId: string;
  choice: string;
  signature?: Hex;
  nonce?: string;
  timestamp?: number;
}

export interface VoteSignatureResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a vote was actually authorized by the voter address.
 * Validates timestamp window and prevents nonce replay.
 */
export async function verifyVoteSignature(
  input: VoteSignatureInput,
): Promise<VoteSignatureResult> {
  const { voter, proposalId, choice, signature, nonce, timestamp } = input;

  if (!signature || !nonce || !timestamp) {
    return { ok: false, reason: "signature, nonce, and timestamp are required" };
  }

  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return { ok: false, reason: "invalid signature format" };
  }

  const now = Date.now();
  const drift = Math.abs(now - timestamp);
  if (drift > SIGNATURE_TTL_MS) {
    return { ok: false, reason: "signature expired or timestamp out of range" };
  }

  const nonceKey = `${voter.toLowerCase()}:${proposalId}:${nonce}`;
  if (seenNonces.has(nonceKey)) {
    return { ok: false, reason: "nonce already used (replay detected)" };
  }

  const message = buildVoteMessage({
    proposalId,
    choice,
    voter,
    nonce,
    timestamp,
  });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: voter,
      message,
      signature,
    });
  } catch {
    return { ok: false, reason: "signature verification failed" };
  }

  if (!valid) {
    return { ok: false, reason: "signature does not match voter address" };
  }

  seenNonces.set(nonceKey, now + SIGNATURE_TTL_MS);
  pruneNonces();

  return { ok: true };
}

/**
 * Decide whether vote signatures are required.
 * - "always": always require
 * - "never": never require (demo mode)
 * - "auto" (default): require when MOC verification is enabled
 */
export function isVoteSignatureRequired(mocEnabled: boolean): boolean {
  if (REQUIRE_VOTE_SIGNATURE === "always") return true;
  if (REQUIRE_VOTE_SIGNATURE === "never") return false;
  return mocEnabled;
}

/**
 * Admin API key middleware. Protects mutation endpoints from anonymous abuse.
 * If ADMIN_API_KEY is unset, the middleware is a no-op (dev convenience).
 */
export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!ADMIN_API_KEY) {
    next();
    return;
  }
  const provided =
    req.header("x-admin-api-key") ||
    (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (provided !== ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function isAdminAuthEnabled(): boolean {
  return Boolean(ADMIN_API_KEY);
}

/**
 * Sanitize an error message before sending to clients.
 * In production, only the first line is returned to avoid leaking stack traces.
 */
export function sanitizeError(error: unknown, fallback: string): string {
  if (!error) return fallback;
  const message =
    typeof error === "string"
      ? error
      : (error as { message?: string })?.message;
  if (!message) return fallback;
  if (!IS_PROD) return message;
  return message.split("\n", 1)[0].slice(0, 200);
}

/**
 * Canonical JSON serialization (RFC 8785 subset): keys sorted alphabetically,
 * arrays preserved in order. Used so that decision packet hashes are reproducible
 * across re-serialization.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
