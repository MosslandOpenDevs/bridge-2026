import { TrustScore, OutcomeProof, now } from "@oracle/core";

export interface TrustManagerConfig {
  initialScore?: number;
  successWeight?: number;
  failureWeight?: number;
  decayRate?: number; // How much old decisions matter less
}

export class TrustManager {
  private scores: Map<string, TrustScore> = new Map();
  private history: Map<string, OutcomeProof[]> = new Map();
  private config: TrustManagerConfig;

  constructor(config: TrustManagerConfig = {}) {
    this.config = {
      initialScore: config.initialScore ?? 50,
      successWeight: config.successWeight ?? 5,
      failureWeight: config.failureWeight ?? 10,
      decayRate: config.decayRate ?? 0.95,
    };
  }

  // Record an outcome and update trust scores
  recordOutcome(
    entityId: string,
    entityType: TrustScore["entityType"],
    proof: OutcomeProof
  ): TrustScore {
    // Get or create score
    let score = this.scores.get(entityId);
    if (!score) {
      score = {
        entityId,
        entityType,
        score: this.config.initialScore!,
        totalDecisions: 0,
        successfulDecisions: 0,
        lastUpdated: now(),
      };
    }

    // Update history
    const entityHistory = this.history.get(entityId) || [];
    entityHistory.push(proof);
    this.history.set(entityId, entityHistory);

    // Update score. proof.successRate is a fraction in [0,1]; it was divided
    // by 100 here as though it were a percentage, which shrank every
    // adjustment to a hundredth of its intended size.
    const successRate = Math.min(1, Math.max(0, proof.successRate));
    score.totalDecisions++;
    if (proof.overallSuccess) {
      score.successfulDecisions++;
      score.score = Math.min(
        100,
        score.score + this.config.successWeight! * successRate
      );
    } else {
      score.score = Math.max(
        0,
        score.score - this.config.failureWeight! * (1 - successRate)
      );
    }

    score.lastUpdated = now();
    this.scores.set(entityId, score);

    return score;
  }

  /**
   * Load a persisted score and its supporting proofs at boot. The score is
   * restored as recorded rather than recomputed, so history that has been
   * pruned cannot silently change an entity's standing.
   */
  restoreScore(score: TrustScore, history: OutcomeProof[] = []): void {
    this.scores.set(score.entityId, score);
    if (history.length > 0) {
      this.history.set(score.entityId, history);
    }
  }

  // Get current trust score
  getScore(entityId: string): TrustScore | undefined {
    return this.scores.get(entityId);
  }

  // Get all scores by type
  getScoresByType(entityType: TrustScore["entityType"]): TrustScore[] {
    return Array.from(this.scores.values()).filter(
      (s) => s.entityType === entityType
    );
  }

  // Get top performers
  getTopPerformers(
    entityType: TrustScore["entityType"],
    limit: number = 10
  ): TrustScore[] {
    return this.getScoresByType(entityType)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Recency-weighted reputation on the same 0-100 scale as `score`.
   * successRate is a fraction, so it is scaled here rather than compared
   * against scores as if it were already a percentage.
   */
  calculateWeightedReputation(entityId: string): number {
    const history = this.history.get(entityId) || [];
    if (history.length === 0) {
      return this.config.initialScore!;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    // Sort by date, most recent first
    const sorted = [...history].sort(
      (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      const proof = sorted[i];
      const weight = Math.pow(this.config.decayRate!, i);
      // Fraction -> 0-100, matching the scale of `score`.
      weightedSum += proof.successRate * 100 * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : this.config.initialScore!;
  }

  // Get historical performance
  getHistory(entityId: string): OutcomeProof[] {
    return this.history.get(entityId) || [];
  }

  // Reset score (for testing or special cases)
  resetScore(entityId: string): void {
    this.scores.delete(entityId);
    this.history.delete(entityId);
  }

  // Export all data for analysis
  exportData(): {
    scores: TrustScore[];
    history: { entityId: string; proofs: OutcomeProof[] }[];
  } {
    return {
      scores: Array.from(this.scores.values()),
      history: Array.from(this.history.entries()).map(([entityId, proofs]) => ({
        entityId,
        proofs,
      })),
    };
  }
}
