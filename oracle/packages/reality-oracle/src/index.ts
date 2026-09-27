// Adapters
export { BaseAdapter } from "./adapters/base.js";
export { OnChainAdapter, type OnChainAdapterConfig } from "./adapters/onchain.js";
export { APIAdapter, type APIAdapterConfig, type APIEndpoint } from "./adapters/api.js";
export {
  TelemetryAdapter,
  type TelemetryAdapterConfig,
  type TelemetryMetric,
} from "./adapters/telemetry.js";
export { MockAdapter, type MockAdapterConfig } from "./adapters/mock.js";

// Real Data Adapters
export { EtherscanAdapter, type EtherscanAdapterConfig } from "./adapters/etherscan.js";
export {
  MosslandAdapter,
  disclosureAlias,
  disclosureKey,
  DISCLOSURE_EVENT_CATEGORY,
  DISCLOSURE_TOTAL_CATEGORY,
  PRICE_ALERT_CATEGORY,
  priceAlertKey,
  type MosslandAdapterConfig,
  type MosslandAdapterState,
  type MosslandNormalizedSignal,
  type StoredMosslandSignal,
} from "./adapters/mossland.js";
export { GitHubAdapter, type GitHubAdapterConfig } from "./adapters/github.js";
export { SocialAdapter, type SocialAdapterConfig } from "./adapters/social.js";

// Registry
export { SignalRegistry, type SignalRegistryConfig } from "./registry.js";

// Re-export core types for convenience
export type {
  SignalAdapter,
  SignalSource,
  RawSignal,
  NormalizedSignal,
} from "@oracle/core";
