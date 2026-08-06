/**
 * Wallet ownership proofs for the mutating governance endpoints.
 *
 * A vote's weight is the caller's on-chain Moss Coin balance, and a delegation
 * policy hands an agent the delegator's influence. A request that merely names
 * a wallet address is therefore a request to spend somebody else's stake, so it
 * has to carry a signature produced by that wallet over a message that binds
 * every parameter of the operation, plus a nonce and a timestamp so a captured
 * signature cannot be replayed.
 *
 * The message layout, the TTL and the "never is honoured outside production
 * only" rule deliberately mirror oracle/apps/api/src/security.ts so the two
 * trees read the same way; only the crypto library differs, because this tree
 * already depends on ethers and the oracle on viem.
 */

import { getAddress, verifyMessage } from 'ethers';

/**
 * Read at call time, not at module load. Nest's ConfigModule loads .env while
 * building the module graph, which happens *after* this file is first
 * required, so a module-level snapshot sees no NODE_ENV at all — and an
 * operator who follows the README and writes NODE_ENV=production into .env
 * would get the development posture, with REQUIRE_*_SIGNATURE=never honoured.
 */
function isProduction(): boolean {
  return (process.env.NODE_ENV || 'development') === 'production';
}

/** How long a signed request stays acceptable, in either direction. */
const SIGNATURE_TTL_MS = 5 * 60 * 1000;
const NONCE_CACHE_LIMIT = 5000;

/**
 * Replay protection is per-process. A horizontally scaled deployment needs a
 * shared store here, otherwise one signature can be spent once per instance.
 */
const seenNonces = new Map<string, number>();

function pruneNonces(): void {
  if (seenNonces.size <= NONCE_CACHE_LIMIT) return;
  const now = Date.now();
  for (const [key, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(key);
    if (seenNonces.size <= NONCE_CACHE_LIMIT) break;
  }
}

export interface SignatureResult {
  ok: boolean;
  reason?: string;
}

/**
 * EIP-55 checksummed form of an address. Everything that compares, stores or
 * signs an address must go through this: the duplicate-vote check, the signed
 * message and the persisted row have to agree on one spelling, or the same
 * holder votes twice by changing the casing.
 *
 * Throws when the input is not an address.
 */
export function toCanonicalAddress(value: string): string {
  return getAddress(value.trim());
}

/**
 * Canonical JSON (RFC 8785 subset): object keys sorted, array order kept. The
 * signed message embeds the policy this way so that re-serialising the same
 * policy always produces the same bytes to sign and to verify.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * The first line is a domain separator: it keeps a signature collected here
 * from being replayed against the sibling oracle deployment, which prefixes
 * its own messages with "BRIDGE Oracle Vote".
 */
export function buildVoteMessage(params: {
  proposalId: string;
  choice: string;
  voter: string;
  nonce: string;
  timestamp: number;
}): string {
  const { proposalId, choice, voter, nonce, timestamp } = params;
  return [
    'BRIDGE 2026 Vote',
    `Proposal: ${proposalId}`,
    `Voter: ${voter.toLowerCase()}`,
    `Choice: ${choice.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');
}

export interface DelegationMessageParams {
  action: 'create' | 'delete';
  /** Wallet whose voting power the policy delegates. */
  wallet: string;
  /** Agent receiving the delegation; absent when deleting. */
  agentId?: string;
  /** Canonical JSON of the policy terms; absent when deleting. */
  policy?: string;
  /** Policy being deleted; absent when creating. */
  policyId?: string;
  nonce: string;
  timestamp: number;
}

export function buildDelegationMessage(params: DelegationMessageParams): string {
  const lines = [
    'BRIDGE 2026 Delegation',
    `Action: ${params.action}`,
    `Wallet: ${params.wallet.toLowerCase()}`,
  ];
  if (params.action === 'create') {
    lines.push(
      `Agent: ${(params.agentId || '').trim()}`,
      `Policy: ${params.policy ?? '{}'}`,
    );
  } else {
    lines.push(`PolicyId: ${params.policyId ?? ''}`);
  }
  lines.push(`Nonce: ${params.nonce}`, `Timestamp: ${params.timestamp}`);
  return lines.join('\n');
}

/**
 * Whether a wallet signature is demanded. Signatures are always required in
 * production; "never" exists so a local demo can drive the API without a
 * wallet and is ignored once NODE_ENV=production.
 */
function isSignatureRequired(envVar: string): boolean {
  const mode = (process.env[envVar] || 'always').toLowerCase();
  if (mode === 'never' && !isProduction()) return false;
  return true;
}

export function isVoteSignatureRequired(): boolean {
  return isSignatureRequired('REQUIRE_VOTE_SIGNATURE');
}

export function isDelegationSignatureRequired(): boolean {
  return isSignatureRequired('REQUIRE_DELEGATION_SIGNATURE');
}

/**
 * Verify that `signer` produced `signature` over `message`, that the request is
 * inside the freshness window, and that this nonce has not been used before.
 *
 * `nonceScope` separates the namespaces (a vote nonce must not unlock a
 * delegation change), and the nonce is only burned after the signature checks
 * out, so a bad signature cannot be used to exhaust a victim's nonces.
 */
async function verifySignedMessage(input: {
  message: string;
  signer: string;
  nonceScope: string;
  signature?: string;
  nonce?: string;
  timestamp?: number;
}): Promise<SignatureResult> {
  const { message, signer, nonceScope, signature, nonce, timestamp } = input;

  if (!signature || !nonce || !timestamp) {
    return { ok: false, reason: 'signature, nonce, and timestamp are required' };
  }

  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return { ok: false, reason: 'invalid signature format' };
  }

  if (Math.abs(Date.now() - timestamp) > SIGNATURE_TTL_MS) {
    return { ok: false, reason: 'signature expired or timestamp out of range' };
  }

  const nonceKey = `${nonceScope}:${signer.toLowerCase()}:${nonce}`;
  if (seenNonces.has(nonceKey)) {
    return { ok: false, reason: 'nonce already used (replay detected)' };
  }

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return { ok: false, reason: 'signature verification failed' };
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    return { ok: false, reason: 'signature does not match the claimed address' };
  }

  // Retained until the signature itself expires, which is measured from the
  // signed timestamp — not from now. A clock ahead of the server's makes a
  // signature live past `now + TTL`, so retaining from now would drop the
  // nonce record while the signature it guards is still acceptable.
  seenNonces.set(nonceKey, timestamp + SIGNATURE_TTL_MS);
  pruneNonces();

  return { ok: true };
}

export async function verifyVoteSignature(input: {
  voter: string;
  proposalId: string;
  choice: string;
  signature?: string;
  nonce?: string;
  timestamp?: number;
}): Promise<SignatureResult> {
  const { voter, proposalId, choice, signature, nonce, timestamp } = input;

  return verifySignedMessage({
    message: buildVoteMessage({
      proposalId,
      choice,
      voter,
      nonce: nonce || '',
      timestamp: timestamp || 0,
    }),
    signer: voter,
    // Scoped by proposal so one nonce per proposal is enough for a voter.
    nonceScope: `vote:${proposalId}`,
    signature,
    nonce,
    timestamp,
  });
}

export async function verifyDelegationSignature(input: {
  message: string;
  wallet: string;
  signature?: string;
  nonce?: string;
  timestamp?: number;
}): Promise<SignatureResult> {
  return verifySignedMessage({
    message: input.message,
    signer: input.wallet,
    nonceScope: 'delegation',
    signature: input.signature,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });
}
