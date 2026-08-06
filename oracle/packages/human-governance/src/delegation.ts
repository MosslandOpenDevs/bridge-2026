import {
  DelegationPolicy,
  Proposal,
  VoteChoice,
  generateId,
  now,
} from "@oracle/core";

export interface DelegationCondition {
  field: string;
  operator: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "in" | "contains";
  value: unknown;
}

export class DelegationManager {
  private policies: Map<string, DelegationPolicy> = new Map();
  private delegatorIndex: Map<string, Set<string>> = new Map();

  createPolicy(
    delegator: string,
    delegate: string,
    conditions: DelegationCondition[],
    expiresAt?: Date
  ): DelegationPolicy {
    const policy: DelegationPolicy = {
      id: generateId(),
      delegator,
      delegate,
      conditions: conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      })),
      expiresAt,
      active: true,
    };

    this.policies.set(policy.id, policy);

    // Update index
    const delegatorPolicies = this.delegatorIndex.get(delegator) || new Set();
    delegatorPolicies.add(policy.id);
    this.delegatorIndex.set(delegator, delegatorPolicies);

    return policy;
  }

  /** Load a persisted policy at boot, indexes included. */
  restorePolicy(policy: DelegationPolicy): void {
    this.policies.set(policy.id, policy);
    const delegatorPolicies =
      this.delegatorIndex.get(policy.delegator) || new Set<string>();
    delegatorPolicies.add(policy.id);
    this.delegatorIndex.set(policy.delegator, delegatorPolicies);
  }

  revokePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (policy) {
      policy.active = false;
    }
  }

  getPolicy(policyId: string): DelegationPolicy | undefined {
    return this.policies.get(policyId);
  }

  getPoliciesForDelegator(delegator: string): DelegationPolicy[] {
    const policyIds = this.delegatorIndex.get(delegator) || new Set();
    return Array.from(policyIds)
      .map((id) => this.policies.get(id))
      .filter((p): p is DelegationPolicy => p !== undefined && p.active);
  }

  // Check if a proposal matches the conditions for automatic delegation
  shouldAutoDelegate(
    delegator: string,
    proposal: Proposal
  ): { delegate: string; policy: DelegationPolicy } | null {
    const policies = this.getPoliciesForDelegator(delegator);

    for (const policy of policies) {
      // Check expiration
      if (policy.expiresAt && policy.expiresAt < now()) {
        continue;
      }

      // Check all conditions
      const allConditionsMet = policy.conditions.every((condition) =>
        this.evaluateCondition(condition, proposal)
      );

      if (allConditionsMet) {
        return { delegate: policy.delegate, policy };
      }
    }

    return null;
  }

  private evaluateCondition(
    condition: DelegationPolicy["conditions"][0],
    proposal: Proposal
  ): boolean {
    // Get the value from the proposal based on the field path
    const value = this.getFieldValue(proposal, condition.field);
    const compareValue = condition.value;

    switch (condition.operator) {
      case "eq":
        return value === compareValue;
      case "ne":
        return value !== compareValue;
      case "gt":
        return typeof value === "number" && value > (compareValue as number);
      case "lt":
        return typeof value === "number" && value < (compareValue as number);
      case "gte":
        return typeof value === "number" && value >= (compareValue as number);
      case "lte":
        return typeof value === "number" && value <= (compareValue as number);
      case "in":
        return Array.isArray(compareValue) && compareValue.includes(value);
      case "contains":
        return (
          typeof value === "string" &&
          value.includes(compareValue as string)
        );
      default:
        return false;
    }
  }

  private getFieldValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}

// Pre-defined delegation policy templates
export const DELEGATION_TEMPLATES = {
  // Delegate all low-priority proposals
  lowPriorityOnly: (delegate: string): DelegationCondition[] => [
    { field: "decisionPacket.issue.priority", operator: "eq", value: "low" },
  ],

  // Delegate proposals in specific categories
  categoryBased: (
    delegate: string,
    categories: string[]
  ): DelegationCondition[] => [
    { field: "decisionPacket.issue.category", operator: "in", value: categories },
  ],

  // Delegate proposals with high agent consensus
  highConsensus: (delegate: string): DelegationCondition[] => [
    // This would need more complex evaluation in practice
    {
      field: "decisionPacket.dissent",
      operator: "eq",
      value: [], // No dissenting opinions
    },
  ],
};
