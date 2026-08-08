import { NormalizedSignal, DetectedIssue, TrendDirection, IssueKind } from "@oracle/core";
import { BaseDetector } from "./base.js";

// Metric configuration for category-specific behavior
export interface MetricConfig {
  // Whether increasing is positive (good) or negative (bad)
  increasingIsPositive: boolean;
  // Priority thresholds (multipliers of trendThreshold)
  urgentThreshold: number;
  highThreshold: number;
  mediumThreshold: number;
  // Whether to create issue or insight for positive changes
  positiveAsInsight: boolean;
}

// Default metric configurations
const DEFAULT_METRIC_CONFIGS: Record<string, MetricConfig> = {
  // Token price: decreasing is bad, increasing is neutral/good
  token_price: {
    increasingIsPositive: true,
    urgentThreshold: 5,
    highThreshold: 3,
    mediumThreshold: 2,
    positiveAsInsight: true,
  },
  moc_price: {
    increasingIsPositive: true,
    urgentThreshold: 5,
    highThreshold: 3,
    mediumThreshold: 2,
    positiveAsInsight: true,
  },
  // Vote turnout: increasing is good (healthy governance)
  vote_turnout: {
    increasingIsPositive: true,
    urgentThreshold: 10, // Very high threshold - rarely urgent
    highThreshold: 7,
    mediumThreshold: 5,
    positiveAsInsight: true, // Increasing vote turnout is insight, not issue
  },
  governance_participation: {
    increasingIsPositive: true,
    urgentThreshold: 10,
    highThreshold: 7,
    mediumThreshold: 5,
    positiveAsInsight: true,
  },
  // Community sentiment: decreasing is bad
  community_sentiment: {
    increasingIsPositive: true,
    urgentThreshold: 3,
    highThreshold: 2,
    mediumThreshold: 1.5,
    positiveAsInsight: true,
  },
  // Protocol TVL: increasing is generally good
  protocol_tvl: {
    increasingIsPositive: true,
    urgentThreshold: 5,
    highThreshold: 3,
    mediumThreshold: 2,
    positiveAsInsight: true,
  },
  // Network gas: increasing is bad (expensive)
  network_gas: {
    increasingIsPositive: false,
    urgentThreshold: 3,
    highThreshold: 2,
    mediumThreshold: 1.5,
    positiveAsInsight: false,
  },
  // Transaction volume: increasing is generally good
  transaction_volume: {
    increasingIsPositive: true,
    urgentThreshold: 10,
    highThreshold: 7,
    mediumThreshold: 5,
    positiveAsInsight: true,
  },
};

// Default config for unknown categories
const DEFAULT_CONFIG: MetricConfig = {
  increasingIsPositive: false, // Conservative: treat unknown increases as potentially bad
  urgentThreshold: 5,
  highThreshold: 3,
  mediumThreshold: 2,
  positiveAsInsight: false,
};

export interface TrendDetectorConfig {
  minDataPoints?: number;
  trendThreshold?: number;
  categories?: string[];
  metricConfigs?: Record<string, MetricConfig>;
  /**
   * Least of the variance a straight line must explain before the trend is
   * treated as actionable. See MIN_R_SQUARED.
   */
  minRSquared?: number;
}

/**
 * A slope alone says nothing about whether there is a trend.
 *
 * Escalation used to key on `Math.abs(slope)` while r² was computed, written
 * into the evidence, and never read. Over a window of 30 uncorrelated values
 * the standard deviation of the fitted slope is large enough that a meaningful
 * share of pure noise clears the `urgent` multiplier — so noise escalated
 * forever, once per category, and each escalation was a candidate for a paid
 * deliberation. One such issue reached a live, chain-snapshotted proposal to
 * pause governance changes, carrying `"rSquared": 0.063` in its own evidence.
 *
 * 0.5 is deliberately permissive: half the variance explained is a low bar for
 * a real trend and well clear of what noise reaches. A weak fit is not
 * discarded — it still surfaces, capped at `low`, which is below the priority
 * automatic deliberation acts on.
 */
const MIN_R_SQUARED = 0.5;

export class TrendDetector extends BaseDetector {
  readonly name = "TrendDetector";
  private config: TrendDetectorConfig;
  private metricConfigs: Record<string, MetricConfig>;

  constructor(config: TrendDetectorConfig = {}) {
    super();
    this.config = {
      minDataPoints: config.minDataPoints ?? 5,
      trendThreshold: config.trendThreshold ?? 0.1,
      categories: config.categories ?? [],
      minRSquared: config.minRSquared ?? MIN_R_SQUARED,
    };
    this.metricConfigs = {
      ...DEFAULT_METRIC_CONFIGS,
      ...(config.metricConfigs || {}),
    };
  }

  private getMetricConfig(category: string): MetricConfig {
    // Try exact match first
    if (this.metricConfigs[category]) {
      return this.metricConfigs[category];
    }
    // Try prefix match (e.g., "token_*" matches "token_price")
    for (const [key, config] of Object.entries(this.metricConfigs)) {
      if (category.startsWith(key.replace("_*", "_"))) {
        return config;
      }
    }
    return DEFAULT_CONFIG;
  }

  analyze(signals: NormalizedSignal[]): DetectedIssue[] {
    const issues: DetectedIssue[] = [];
    const grouped = this.groupSignalsByCategory(signals);

    for (const [category, categorySignals] of grouped) {
      if (
        this.config.categories!.length > 0 &&
        !this.config.categories!.includes(category)
      ) {
        continue;
      }

      if (categorySignals.length < this.config.minDataPoints!) {
        continue;
      }

      const sorted = [...categorySignals].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      const trend = this.calculateTrend(sorted);

      if (Math.abs(trend.slope) < this.config.trendThreshold!) {
        continue;
      }

      const direction: TrendDirection = trend.slope > 0 ? "increasing" : "decreasing";
      const magnitude = Math.abs(trend.slope);
      const metricConfig = this.getMetricConfig(category);

      // Determine if this is a positive or negative change
      const isPositiveChange =
        (direction === "increasing" && metricConfig.increasingIsPositive) ||
        (direction === "decreasing" && !metricConfig.increasingIsPositive);

      // Determine kind: positive changes can be insights instead of issues
      const kind: IssueKind = isPositiveChange && metricConfig.positiveAsInsight
        ? "insight"
        : "issue";

      // Calculate priority based on metric config and direction
      let priority: DetectedIssue["priority"] = "low";
      const threshold = this.config.trendThreshold!;

      if (isPositiveChange) {
        // Positive changes have much lower priority
        if (magnitude > threshold * metricConfig.urgentThreshold) {
          priority = "medium"; // Max priority for positive changes
        } else if (magnitude > threshold * metricConfig.highThreshold) {
          priority = "low";
        }
      } else {
        // Negative changes use normal priority escalation
        if (magnitude > threshold * metricConfig.urgentThreshold) {
          priority = "urgent";
        } else if (magnitude > threshold * metricConfig.highThreshold) {
          priority = "high";
        } else if (magnitude > threshold * metricConfig.mediumThreshold) {
          priority = "medium";
        }
      }

      // A line that explains nothing about the data is not a trend to act on,
      // however steep it came out. Kept visible, but held below the priority
      // automatic deliberation spends money on.
      const fitIsWeak = trend.rSquared < this.config.minRSquared!;
      if (fitIsWeak && priority !== "low") {
        priority = "low";
      }

      const firstValue = sorted[0].value;
      const lastValue = sorted[sorted.length - 1].value;
      const percentChange = ((lastValue - firstValue) / firstValue) * 100;

      // Build title based on kind
      const title = kind === "insight"
        ? `Positive trend: ${category} ${direction}`
        : `${direction.charAt(0).toUpperCase() + direction.slice(1)} trend in ${category}`;

      const description = kind === "insight"
        ? `A positive ${direction} trend observed in ${category}. ` +
          `Values changed from ${firstValue.toFixed(2)} to ${lastValue.toFixed(2)} ` +
          `(${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}%) over ${sorted.length} data points. ` +
          `This is a positive indicator and can be used for learning.`
        : `A significant ${direction} trend detected in ${category}. ` +
          `Values changed from ${firstValue.toFixed(2)} to ${lastValue.toFixed(2)} ` +
          `(${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}%) over ${sorted.length} data points.`;

      const suggestedActions = kind === "insight"
        ? [
            `Track contributing factors for the positive ${direction} trend`,
            `Document learnings for future reference`,
            `Consider if this trend can be replicated in other areas`,
          ]
        : [
            `Monitor the ${direction} trend in ${category}`,
            `Investigate factors contributing to the ${percentChange.toFixed(1)}% change`,
            direction === "increasing" && percentChange > 50
              ? "Consider implementing rate limiting or controls"
              : "Review if this trend aligns with expectations",
          ];

      const issue = this.createIssue(
        title,
        description,
        category,
        priority,
        sorted,
        [
          {
            type: "trend",
            description: "Trend analysis results",
            data: {
              direction,
              slope: trend.slope,
              intercept: trend.intercept,
              rSquared: trend.rSquared,
              dataPoints: sorted.length,
              firstValue,
              lastValue,
              percentChange,
              isPositiveChange,
              kind,
              // Stated, not just recorded: a reader comparing a steep slope
              // against a `low` priority needs to see why they disagree.
              fitIsWeak,
              minRSquared: this.config.minRSquared,
            },
          },
        ],
        suggestedActions,
        { direction, kind }
      );

      issues.push(issue);
    }

    return issues;
  }

  private calculateTrend(signals: NormalizedSignal[]): {
    slope: number;
    intercept: number;
    rSquared: number;
  } {
    const n = signals.length;
    const xValues = signals.map((_, i) => i);
    const yValues = signals.map((s) => s.value);

    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((acc, x, i) => acc + x * yValues[i], 0);
    const sumX2 = xValues.reduce((acc, x) => acc + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const yMean = sumY / n;
    const ssTotal = yValues.reduce((acc, y) => acc + Math.pow(y - yMean, 2), 0);
    const ssResidual = yValues.reduce((acc, y, i) => {
      const predicted = slope * xValues[i] + intercept;
      return acc + Math.pow(y - predicted, 2);
    }, 0);
    const rSquared = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

    return { slope, intercept, rSquared };
  }
}
