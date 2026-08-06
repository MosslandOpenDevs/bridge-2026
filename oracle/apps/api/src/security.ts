/**
 * Security utilities: vote signature verification, admin auth, replay protection,
 * canonical JSON hashing, and error sanitization.
 */

import { timingSafeEqual } from "node:crypto";
import { verifyMessage, type Address, type Hex } from "viem";
import type { Request, Response, NextFunction } from "express";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
/**
 * Opt-in escape hatch for local demos, honoured outside production only.
 * It leaves every admin endpoint anonymous, so it must never be set on a
 * deployment that anyone else can reach.
 */
const DEMO_MODE = process.env.DEMO_MODE === "1" && !IS_PROD;
/** Shortest key we accept; a two-character "key" is not a credential. */
const MIN_ADMIN_KEY_LENGTH = 16;
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

/* ------------------------------------------------------------------ *
 * Delegation authorization
 *
 * A delegation policy hands someone else the delegator's voting influence,
 * so creating or revoking one must be proven by the delegator's wallet.
 * ------------------------------------------------------------------ */

export interface DelegationMessageParams {
  action: "create" | "revoke";
  delegator: string;
  /** Agent id or address receiving the delegation; absent when revoking. */
  delegate?: string;
  /** Canonical JSON of the normalized conditions; absent when revoking. */
  conditions?: string;
  expiresAt?: string;
  /** Policy being revoked; absent when creating. */
  policyId?: string;
  nonce: string;
  timestamp: number;
}

export function buildDelegationMessage(params: DelegationMessageParams): string {
  const lines = [
    "BRIDGE Oracle Delegation",
    `Action: ${params.action}`,
    `Delegator: ${params.delegator.toLowerCase()}`,
  ];
  if (params.action === "create") {
    lines.push(
      `Delegate: ${(params.delegate || "").trim()}`,
      `Conditions: ${params.conditions ?? "[]"}`,
      `ExpiresAt: ${params.expiresAt ?? "none"}`,
    );
  } else {
    lines.push(`PolicyId: ${params.policyId ?? ""}`);
  }
  lines.push(`Nonce: ${params.nonce}`, `Timestamp: ${params.timestamp}`);
  return lines.join("\n");
}

/**
 * Whether delegation changes must carry a delegator signature.
 * Always required in production; "never" is honoured only outside it.
 */
export function isDelegationSignatureRequired(): boolean {
  const mode = (process.env.REQUIRE_DELEGATION_SIGNATURE || "always").toLowerCase();
  if (mode === "never" && !IS_PROD) return false;
  return true;
}

export async function verifyDelegationSignature(input: {
  message: string;
  delegator: Address;
  signature?: Hex;
  nonce?: string;
  timestamp?: number;
}): Promise<VoteSignatureResult> {
  const { message, delegator, signature, nonce, timestamp } = input;

  if (!signature || !nonce || !timestamp) {
    return { ok: false, reason: "signature, nonce, and timestamp are required" };
  }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return { ok: false, reason: "invalid signature format" };
  }
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_TTL_MS) {
    return { ok: false, reason: "signature expired or timestamp out of range" };
  }

  const nonceKey = `delegation:${delegator.toLowerCase()}:${nonce}`;
  if (seenNonces.has(nonceKey)) {
    return { ok: false, reason: "nonce already used (replay detected)" };
  }

  let valid = false;
  try {
    valid = await verifyMessage({ address: delegator, message, signature });
  } catch {
    return { ok: false, reason: "signature verification failed" };
  }
  if (!valid) {
    return { ok: false, reason: "signature does not match the delegator address" };
  }

  seenNonces.set(nonceKey, Date.now() + SIGNATURE_TTL_MS);
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
 * How admin endpoints behave in this process:
 * - "enforced":  ADMIN_API_KEY is set; callers must present it.
 * - "demo-open": no key, DEMO_MODE=1, non-production — anonymous access.
 * - "blocked":   no key — admin endpoints are refused outright.
 *
 * "blocked" is the default precisely because the previous behaviour was to
 * fall through to next(): a single missing environment variable opened
 * proposal creation, finalization, execution and outcome recording to anyone.
 */
export type AdminAuthMode = "enforced" | "demo-open" | "blocked";

export const adminAuthMode: AdminAuthMode = ADMIN_API_KEY
  ? "enforced"
  : DEMO_MODE
    ? "demo-open"
    : "blocked";

/**
 * Fail fast at boot rather than at the first admin request. Returns an error
 * message when the process must not start; null when the configuration is
 * acceptable.
 */
export function adminAuthStartupError(): string | null {
  if (IS_PROD && !ADMIN_API_KEY) {
    return (
      "ADMIN_API_KEY is required when NODE_ENV=production. Without it the " +
      "admin endpoints (proposal create/finalize/execute, outcome recording, " +
      "signal collection, issue detection) have no authentication at all. " +
      "Set ADMIN_API_KEY to a random secret of at least " +
      `${MIN_ADMIN_KEY_LENGTH} characters.`
    );
  }
  if (ADMIN_API_KEY && ADMIN_API_KEY.length < MIN_ADMIN_KEY_LENGTH) {
    return `ADMIN_API_KEY is too short (minimum ${MIN_ADMIN_KEY_LENGTH} characters).`;
  }
  if (DEMO_MODE) {
    return null; // allowed, but the caller logs a warning
  }
  return null;
}

/** Constant-time comparison that does not leak the key length through timing. */
function secretEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path has similar cost.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Admin API key middleware. Protects mutation and LLM-spending endpoints from
 * anonymous abuse.
 */
export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (adminAuthMode === "demo-open") {
    next();
    return;
  }

  if (adminAuthMode === "blocked") {
    res.status(503).json({
      error:
        "Admin endpoints are disabled because ADMIN_API_KEY is not configured.",
      code: "ADMIN_AUTH_UNCONFIGURED",
    });
    return;
  }

  const provided =
    req.header("x-admin-api-key") ||
    (req.header("authorization") || "").replace(/^Bearer\s+/i, "");

  if (!provided || !secretEquals(provided, ADMIN_API_KEY as string)) {
    res.status(401).json({ error: "Unauthorized", code: "ADMIN_AUTH_INVALID" });
    return;
  }
  next();
}

export function isAdminAuthEnabled(): boolean {
  return adminAuthMode === "enforced";
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
