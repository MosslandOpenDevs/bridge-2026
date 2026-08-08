import {
  SignalAdapter,
  SignalSource,
  RawSignal,
  NormalizedSignal,
  generateId,
  now,
} from "@oracle/core";

export abstract class BaseAdapter implements SignalAdapter {
  abstract readonly name: string;
  abstract readonly source: SignalSource;

  /**
   * Whether this adapter invents its values instead of observing them.
   *
   * Declared once per adapter rather than per signal: a demo adapter that
   * forgot the flag on one code path would emit synthetic data that reads as
   * real, and everything downstream — issue detection, the agents' evidence,
   * the public API — has no other way to tell the difference.
   */
  protected readonly synthetic: boolean = false;

  abstract fetch(): Promise<RawSignal[]>;

  validate(signal: RawSignal): boolean {
    if (!signal.id || !signal.source || !signal.timestamp) {
      return false;
    }
    if (signal.source !== this.source) {
      return false;
    }
    return true;
  }

  abstract normalize(signal: RawSignal): NormalizedSignal;

  protected createRawSignal(
    sourceId: string,
    data: Record<string, unknown>,
    metadata?: RawSignal["metadata"]
  ): RawSignal {
    return {
      id: generateId(),
      source: this.source,
      sourceId,
      timestamp: now(),
      data,
      metadata,
    };
  }

  protected createNormalizedSignal(
    original: RawSignal,
    category: string,
    severity: NormalizedSignal["severity"],
    value: number,
    unit: string,
    description: string
  ): NormalizedSignal {
    return {
      id: generateId(),
      originalId: original.id,
      source: this.source,
      timestamp: original.timestamp,
      category,
      severity,
      value,
      unit,
      description,
      synthetic: this.synthetic,
    };
  }
}
