/**
 * Client half of the delegation authorization scheme.
 *
 * A delegation policy hands an agent the delegator's voting influence, so the
 * API requires the delegator's wallet to sign for both creating and revoking
 * one. These builders must produce byte-identical messages to
 * buildDelegationMessage() in the API's security module.
 */

export interface DelegationCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface DelegationAuth {
  signature: string;
  nonce: string;
  timestamp: number;
}

type SignMessage = (args: { message: string }) => Promise<string>;

/** RFC 8785-style canonical JSON: object keys sorted, array order preserved. */
function canonicalJson(value: unknown): string {
  const canonicalize = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canonicalize);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return sorted;
  };
  return JSON.stringify(canonicalize(value));
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDelegationCreateMessage(params: {
  delegator: string;
  delegate: string;
  conditions: DelegationCondition[];
  expiresAt?: string;
  nonce: string;
  timestamp: number;
}): string {
  return [
    "BRIDGE Oracle Delegation",
    "Action: create",
    `Delegator: ${params.delegator.toLowerCase()}`,
    `Delegate: ${params.delegate.trim()}`,
    `Conditions: ${canonicalJson(params.conditions)}`,
    `ExpiresAt: ${params.expiresAt ?? "none"}`,
    `Nonce: ${params.nonce}`,
    `Timestamp: ${params.timestamp}`,
  ].join("\n");
}

export function buildDelegationRevokeMessage(params: {
  delegator: string;
  policyId: string;
  nonce: string;
  timestamp: number;
}): string {
  return [
    "BRIDGE Oracle Delegation",
    "Action: revoke",
    `Delegator: ${params.delegator.toLowerCase()}`,
    `PolicyId: ${params.policyId}`,
    `Nonce: ${params.nonce}`,
    `Timestamp: ${params.timestamp}`,
  ].join("\n");
}

export async function signDelegationCreate(params: {
  signMessageAsync: SignMessage;
  delegator: string;
  delegate: string;
  conditions: DelegationCondition[];
  expiresAt?: string;
}): Promise<DelegationAuth> {
  const nonce = newNonce();
  const timestamp = Date.now();
  const signature = await params.signMessageAsync({
    message: buildDelegationCreateMessage({
      delegator: params.delegator,
      delegate: params.delegate,
      conditions: params.conditions,
      expiresAt: params.expiresAt,
      nonce,
      timestamp,
    }),
  });
  return { signature, nonce, timestamp };
}

export async function signDelegationRevoke(params: {
  signMessageAsync: SignMessage;
  delegator: string;
  policyId: string;
}): Promise<DelegationAuth> {
  const nonce = newNonce();
  const timestamp = Date.now();
  const signature = await params.signMessageAsync({
    message: buildDelegationRevokeMessage({
      delegator: params.delegator,
      policyId: params.policyId,
      nonce,
      timestamp,
    }),
  });
  return { signature, nonce, timestamp };
}
