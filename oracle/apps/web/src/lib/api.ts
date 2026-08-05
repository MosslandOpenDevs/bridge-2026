// Empty string means same origin, which lets nginx proxy /api and /socket.io.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

class APIClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // Health
  async getHealth() {
    return this.fetch<{ status: string; version: string; timestamp: string }>("/health");
  }

  // Signals
  async getSignals(limit: number = 500) {
    return this.fetch<{ signals: any[]; count: number }>(`/api/signals?limit=${limit}`);
  }

  async collectSignals() {
    return this.fetch<{ collected: number; signals: any[] }>("/api/signals/collect", {
      method: "POST",
    });
  }

  // Issues
  async getIssues(status?: string) {
    const query = status ? `?status=${status}` : "";
    return this.fetch<{ issues: any[]; count: number }>(`/api/issues${query}`);
  }

  async detectIssues() {
    return this.fetch<{ detected: number; saved: number; issues: any[]; count: number }>("/api/issues/detect", {
      method: "POST",
    });
  }

  async updateIssue(id: string, data: { status?: string; decisionPacket?: any }) {
    return this.fetch<{ issue: any }>(`/api/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Deliberation
  async deliberate(issue: any, context?: any) {
    return this.fetch<{ decisionPacket: any }>("/api/deliberate", {
      method: "POST",
      body: JSON.stringify({ issue, context }),
    });
  }

  // Debate (multi-round discussion)
  async startDebate(issue: any, context?: any, maxRounds?: number) {
    return this.fetch<{ debateSession: any; decisionPacket: any }>("/api/debate", {
      method: "POST",
      body: JSON.stringify({ issue, context, maxRounds }),
    });
  }

  async getDebateSession(sessionId: string) {
    return this.fetch<{ debateSession: any }>(`/api/debate/${sessionId}`);
  }

  async getDebateSessions() {
    return this.fetch<{ debateSessions: any[]; count: number }>("/api/debates");
  }

  // Proposals
  async getProposals(status?: string) {
    const query = status ? `?status=${status}` : "";
    return this.fetch<{ proposals: any[]; count: number }>(`/api/proposals${query}`);
  }

  async createProposal(decisionPacket: any, proposer: string, options?: any) {
    return this.fetch<{ proposal: any }>("/api/proposals", {
      method: "POST",
      body: JSON.stringify({ decisionPacket, proposer, options }),
    });
  }

  async getProposal(id: string) {
    return this.fetch<{ proposal: any }>(`/api/proposals/${id}`);
  }

  async castVote(
    proposalId: string,
    voter: string,
    choice: string,
    weight: string,
    reason?: string,
    auth?: { signature: string; nonce: string; timestamp: number }
  ) {
    return this.fetch<{ vote: any }>(`/api/proposals/${proposalId}/vote`, {
      method: "POST",
      body: JSON.stringify({ voter, choice, weight, reason, ...auth }),
    });
  }

  async tallyVotes(proposalId: string) {
    return this.fetch<{ tally: any }>(`/api/proposals/${proposalId}/tally`, {
      method: "POST",
    });
  }

  async finalizeProposal(proposalId: string) {
    return this.fetch<{ proposal: any }>(`/api/proposals/${proposalId}/finalize`, {
      method: "POST",
    });
  }

  async executeProposal(proposalId: string) {
    return this.fetch<{ proposal: any; execution: any; message: string }>(`/api/proposals/${proposalId}/execute`, {
      method: "POST",
    });
  }

  // Outcomes
  async getOutcomes() {
    return this.fetch<{ outcomes: any[]; count: number }>("/api/outcomes");
  }

  async recordOutcome(proposalId: string, actions: any[]) {
    return this.fetch<{ execution: any }>("/api/outcomes", {
      method: "POST",
      body: JSON.stringify({ proposalId, actions }),
    });
  }

  async getExecution(executionId: string) {
    return this.fetch<{ execution: any }>(`/api/outcomes/${executionId}`);
  }

  async getOutcomeProof(executionId: string) {
    return this.fetch<{ proof: any }>(`/api/outcomes/${executionId}/proof`);
  }

  // Trust
  async getTrustScore(entityId: string) {
    return this.fetch<{ score: any }>(`/api/trust/${entityId}`);
  }

  async getLeaderboard(type: string, limit?: number) {
    const query = limit ? `?limit=${limit}` : "";
    return this.fetch<{ leaderboard: any[] }>(`/api/trust/leaderboard/${type}${query}`);
  }

  // Delegations
  async getDelegations(delegator?: string) {
    const query = delegator ? `?delegator=${delegator}` : "";
    return this.fetch<{ policies: any[]; count: number }>(`/api/delegations${query}`);
  }

  async createDelegation(delegator: string, delegate: string, conditions?: any[], expiresAt?: string) {
    return this.fetch<{ policy: any }>("/api/delegations", {
      method: "POST",
      body: JSON.stringify({ delegator, delegate, conditions, expiresAt }),
    });
  }

  async getDelegation(id: string) {
    return this.fetch<{ policy: any }>(`/api/delegations/${id}`);
  }

  async revokeDelegation(id: string) {
    return this.fetch<{ message: string; policy: any }>(`/api/delegations/${id}`, {
      method: "DELETE",
    });
  }

  async checkDelegation(proposalId: string, delegator: string) {
    return this.fetch<{ shouldDelegate: boolean; delegate?: string; policy?: any }>(
      `/api/delegations/check/${proposalId}?delegator=${delegator}`
    );
  }

  // Stats
  async getStats() {
    return this.fetch<{
      signals: {
        total: number;
        byCategory: { category: string; count: number }[];
        adapterCount: number;
      };
      issues: {
        total: number;
        byStatus: { status: string; count: number }[];
      };
      proposals: { total: number; active: number; passed: number; rejected: number };
      outcomes: { totalProofs: number; successRate: number };
    }>("/api/stats");
  }
}

export const api = new APIClient(API_BASE_URL);
