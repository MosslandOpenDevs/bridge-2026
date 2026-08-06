/**
 * API Client
 * 
 * 백엔드 API와 통신하는 클라이언트입니다.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Read calls take an `AbortSignal` so a component that unmounts (or refetches
 * under a new filter) can drop the in-flight request instead of resolving into
 * a dead component and overwriting newer state.
 */
export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * True for the rejection `fetch` produces when its signal is aborted. Callers
 * must not surface that as a failure — the request was cancelled on purpose.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export const api = {
  // Signals
  getSignals: (
    params?: {
      sourceType?: string;
      limit?: number;
      offset?: number;
    },
    options?: RequestOptions
  ) => {
    const query = new URLSearchParams();
    if (params?.sourceType) query.append('sourceType', params.sourceType);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    return fetchAPI<{ signals: any[]; total: number }>(
      `/api/signals?${query.toString()}`,
      { signal: options?.signal }
    );
  },

  collectSignals: () => {
    return fetchAPI<{ collected: number }>('/api/signals/collect', {
      method: 'POST',
    });
  },

  // Proposals
  getProposals: (
    params?: {
      status?: string;
      limit?: number;
      offset?: number;
    },
    options?: RequestOptions
  ) => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    return fetchAPI<{ proposals: any[]; total: number }>(
      `/api/proposals?${query.toString()}`,
      { signal: options?.signal }
    );
  },

  getProposal: (id: string, options?: RequestOptions) => {
    return fetchAPI<any>(`/api/proposals/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  },

  castVote: (proposalId: string, data: {
    voterAddress: string;
    choice: 'yes' | 'no' | 'abstain';
    txHash?: string;
  }) => {
    return fetchAPI<{ success: boolean; txHash?: string }>(
      `/api/proposals/${proposalId}/vote`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },

  // Delegation
  getDelegationPolicies: (wallet?: string, options?: RequestOptions) => {
    const query = wallet
      ? `?${new URLSearchParams({ wallet }).toString()}`
      : '';
    return fetchAPI<Array<any>>(`/api/delegation/policies${query}`, {
      signal: options?.signal,
    });
  },

  createDelegationPolicy: (data: any) => {
    return fetchAPI<any>('/api/delegation/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteDelegationPolicy: (id: string) => {
    return fetchAPI<{ success: boolean }>(`/api/delegation/policies/${id}`, {
      method: 'DELETE',
    });
  },

  // Outcomes
  getOutcomes: (
    params?: {
      status?: string;
      limit?: number;
      offset?: number;
    },
    options?: RequestOptions
  ) => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    return fetchAPI<{ outcomes: any[]; total: number }>(
      `/api/outcomes?${query.toString()}`,
      { signal: options?.signal }
    );
  },

  getOutcome: (id: string, options?: RequestOptions) => {
    return fetchAPI<any>(`/api/outcomes/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  },
};









