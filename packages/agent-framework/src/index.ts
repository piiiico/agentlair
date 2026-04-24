// ---------------------------------------------------------------------------
// @agentlair/agent-framework
//
// Trust middleware for Microsoft Agent Framework 1.0.
//
// Adds behavioral trust scoring, tool-call gating, and A2A trust
// verification to MCP+A2A dual-native agents. Three integration layers:
//
//   1. FILTERS  — Gate tool execution by trust score (Semantic Kernel heritage)
//   2. TELEMETRY — Collect behavioral events for trust score computation
//   3. A2A TRUST — Verify agent identity before accepting delegated tasks
//
// Quick start:
//
//   import { createTrustFilter, TelemetryCollector, createA2ATrustHandler }
//     from '@agentlair/agent-framework';
//
//   // 1. Add trust filter to your kernel
//   kernel.addFilter('functionInvocation', createTrustFilter({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//     minimumScore: 200,
//   }));
//
//   // 2. Start telemetry collection
//   const telemetry = new TelemetryCollector({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//   });
//
//   // 3. Verify A2A delegations
//   const a2aTrust = createA2ATrustHandler({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//     minimumScore: 300,
//   });
// ---------------------------------------------------------------------------

// Filters
export { createTrustFilter, createTelemetryFilter } from "./filters.js";
export type { TrustFilterOptions } from "./filters.js";

// Telemetry
export { TelemetryCollector } from "./telemetry.js";
export type { TelemetryCollectorOptions } from "./telemetry.js";

// A2A Trust
export {
  createA2ATrustHandler,
  enrichAgentCard,
  enrichAgentCardWithScore,
} from "./a2a.js";
export type {
  A2ATrustHandlerOptions,
  IncomingA2ARequest,
  A2ATrustDecision,
} from "./a2a.js";

// Types
export type {
  // Trust types
  TrustTier,
  TrustScore,
  TrustBreakdown,
  TrustPolicyMap,
  TierPolicy,

  // Agent types
  VerifiedAgent,
  AATClaims,

  // Framework types
  FunctionInvocationContext,
  FunctionInvocationFilter,
  A2ATask,
  A2AMessage,
  A2AArtifact,
  A2AAgentCard,

  // Config
  AgentLairTrustConfig,

  // Events
  BehavioralEvent,
  EventCategory,
  EventResult,
} from "./types.js";

export {
  scoreTier,
  DEFAULT_POLICY,
  DEFAULT_HIGH_RISK_TOOLS,
} from "./types.js";

// Trust client (low-level)
export { fetchTrustScore, emitEvent, emitEvents } from "./trust-client.js";
