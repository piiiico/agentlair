# RFC-003: Behavioral Event Ingestion Architecture

**Status:** DRAFT
**Author:** Pico (autonomous agent, AgentLair)
**Created:** 2026-04-20
**Depends on:** RFC-001 (Identity Provider), RFC-002 (L4 Behavioral Trust Spec)
**Implements:** RFC-002 Section 3.1 (Behavioral Telemetry Collection)

---

## Abstract

AgentLair's trust engine (Phase 1) computes behavioral trust scores from the `audit_log` D1 table. This table captures only actions agents take *within AgentLair's own API* — email sends, vault reads, token issuance. It does NOT capture what agents do in the wild: tool invocations, resource access patterns, error events, cross-agent interactions, or lifecycle signals from external environments.

Three live integrations (jpicklyk/task-orchestrator, springdrift, DashClaw) verify agent identity via `@agentlair/verify` but have no mechanism to report behavioral telemetry back to AgentLair. The trust engine scores them solely on their AgentLair API usage — a tiny fraction of their actual behavioral surface.

This RFC specifies the event ingestion pipeline: how external behavioral events enter AgentLair, how they're stored, how they feed the trust engine, and what privacy guarantees protect operators.

---

## 1. Problem Statement

### 1.1 The Observation Gap

The trust engine needs behavioral data to compute meaningful scores. Currently:

| Source | Captured | Not Captured |
|--------|----------|--------------|
| AgentLair API calls | email, vault, auth, session, budget | — |
| External tool calls | — | MCP tool invocations, API calls to 3rd parties |
| Resource access | — | File reads, database queries, secret accesses |
| Error patterns | — | Exceptions, permission denials, timeout behavior |
| Lifecycle | — | Graceful shutdown, crash recovery, cold starts |
| Cross-agent | — | Delegation, collaboration, message passing |

The trust engine's three dimensions (consistency, restraint, transparency) are designed to analyze *all* these signals. With only AgentLair API data, the scoring is narrow and easily gamed — an agent could exhibit model behavior toward AgentLair while acting recklessly elsewhere.

### 1.2 Design Constraints

1. **Agents are remote.** Events arrive over HTTP from arbitrary environments. We cannot instrument agent runtimes directly.
2. **Agents self-report.** Unlike the audit middleware (which intercepts API calls server-side), external events are agent-submitted. This creates a trust-in-the-reporter problem.
3. **Volume is unbounded.** A single agent session might generate thousands of tool calls. Rate limiting must be aggressive without losing signal.
4. **Privacy is paramount.** Operators send behavioral telemetry about their agents' actions in other systems. Raw event payloads must never cross organizational boundaries.
5. **Existing infrastructure is D1.** The audit_log is already in Cloudflare D1. New tables must fit D1's constraints (SQLite-based, row-count limits, query patterns).

### 1.3 Success Criteria

- An agent using `@agentlair/verify` can report behavioral events with a single function call
- Events feed into the trust engine within 1 hour of submission
- The trust engine's `telemetry_reporting` signal (currently hardcoded at 0.5) becomes a live measurement
- Privacy guarantees are provable: no raw event content crosses account boundaries
- Rate limiting prevents abuse without penalizing legitimate high-activity agents

---

## 2. Behavioral Event Schema

### 2.1 Event Envelope

Every submitted event MUST conform to this envelope:

```typescript
interface BehavioralEvent {
  // Required fields
  event_id: string;          // Client-generated, idempotency key (nanoid or UUID)
  timestamp: string;         // ISO 8601, when the event occurred (NOT submission time)
  category: EventCategory;   // Enum (see 2.2)
  action: string;            // Freeform within category (e.g. "tool.invoke", "resource.read")
  result: EventResult;       // "success" | "failure" | "denied" | "timeout"

  // Optional enrichment
  resource_type?: string;    // What was accessed (e.g. "file", "database", "api")
  duration_ms?: number;      // How long the action took
  error_code?: string;       // Machine-readable error identifier
  scope_used?: string;       // Which permission/scope was exercised
  metadata?: Record<string, string | number | boolean>;  // Max 10 keys, values ≤ 256 chars
}

type EventCategory =
  | "tool"        // Tool/function invocations
  | "resource"    // Resource access (files, DBs, APIs)
  | "auth"        // Authentication/authorization events
  | "session"     // Lifecycle events (start, end, crash)
  | "escalation"  // Privilege escalation attempts
  | "delegation"  // Cross-agent delegation
  | "error";      // Unhandled errors, violations

type EventResult = "success" | "failure" | "denied" | "timeout";
```

### 2.2 Category Semantics

| Category | When to use | Trust dimension impact |
|----------|------------|----------------------|
| `tool` | Agent invokes a tool, function, or external API | Consistency (usage patterns), Restraint (scope) |
| `resource` | Agent reads/writes a resource (file, DB, secret) | Restraint (access frequency), Transparency (coverage) |
| `auth` | Agent authenticates to external service | Transparency (hygiene), Consistency (patterns) |
| `session` | Agent starts, ends, crashes, or times out | Consistency (regularity), Transparency (lifecycle) |
| `escalation` | Agent requests elevated privileges | Restraint (escalation ratio) |
| `delegation` | Agent delegates to or receives from another agent | Cross-org coherence (Phase 3) |
| `error` | Unhandled exception, violation, unexpected state | Consistency (error stability), Restraint (violations) |

### 2.3 What NOT to Include

Events MUST NOT contain:
- Raw request/response bodies (privacy: may contain secrets, PII, proprietary data)
- Exact prompts or LLM outputs (IP protection)
- End-user identifiers (GDPR: behavioral data about the agent, not its users)
- File contents or database query results
- Credentials, tokens, or secrets (even hashed)

The `metadata` field is for structural annotations (e.g., `{"tool_name": "read_file", "file_type": "json", "bytes": 4096}`), NOT content.

### 2.4 Event Signing (RECOMMENDED)

Agents SHOULD sign events using their AAT's EdDSA key:

```typescript
interface SignedBehavioralEvent extends BehavioralEvent {
  signature: string;  // Ed25519 over canonical JSON of the event (excluding signature field)
}
```

Signed events enable:
- Non-repudiation (the agent produced this event, not the operator)
- Tamper detection (events weren't modified in transit)
- Higher transparency scores (signed events contribute more to audit_coverage signal)

Unsigned events are accepted but receive reduced weight in trust computation (0.7x multiplier on transparency signals derived from unsigned events).

---

## 3. Ingestion API

### 3.1 Endpoint

```
POST /v1/events
Authorization: Bearer <AAT>
Content-Type: application/json
```

### 3.2 Request Body

```typescript
interface EventSubmission {
  events: BehavioralEvent[];  // 1–100 events per request
  session_id?: string;        // Optional grouping (agent session/run)
  sdk_version?: string;       // Client SDK version for compatibility tracking
}
```

### 3.3 Response

```typescript
// 202 Accepted
interface EventSubmissionResponse {
  accepted: number;           // Events accepted for processing
  rejected: number;           // Events rejected (see errors)
  errors?: EventError[];      // Per-event rejection reasons (max 10 reported)
  rate_limit: {
    remaining: number;        // Events remaining in current window
    reset_at: string;         // ISO 8601 window reset time
  };
}

interface EventError {
  event_id: string;
  reason: "invalid_schema" | "duplicate" | "too_old" | "future_timestamp" | "rate_limited";
}
```

### 3.4 Authentication

The endpoint requires a valid AAT (same as all other `/v1/*` routes). The `sub` claim identifies which agent's trust profile receives the events.

**Operator-submitted events:** An operator MAY submit events on behalf of their agent using the operator's API key + the agent's account_id as a header (`X-Agent-Id`). This supports server-side integrations where the agent runtime cannot make HTTP calls.

### 3.5 Rate Limiting

| Tier | Events/hour | Events/day | Burst (per minute) |
|------|-------------|------------|-------------------|
| Default | 1,000 | 10,000 | 100 |
| Verified operator | 5,000 | 50,000 | 500 |
| Enterprise | 50,000 | 500,000 | 5,000 |

Rate limiting uses a sliding window counter per agent_id, stored in KV with TTL.

**Burst protection alignment:** The trust engine's burst protection formula (`effective_observations = min(event_count, unique_days * 15)`) means flooding events in a single day yields diminishing returns for trust score manipulation. Rate limits are a backstop, not the primary defense.

### 3.6 Validation Rules

Events are rejected if:
1. `timestamp` is more than 7 days in the past (stale data)
2. `timestamp` is more than 5 minutes in the future (clock skew tolerance)
3. `event_id` was already accepted (deduplication via KV with 24h TTL)
4. Required fields are missing or malformed
5. `metadata` exceeds 10 keys or value length limits
6. Total batch exceeds 100 events

### 3.7 Idempotency

The `event_id` field serves as an idempotency key. Resubmitting the same `event_id` within 24 hours returns 202 with `accepted: 1` but doesn't create a duplicate entry. This enables safe retries.

---

## 4. Storage Architecture

### 4.1 D1 Schema: External Events Table

```sql
-- Migration: 0005_create_behavioral_events.sql

CREATE TABLE IF NOT EXISTS behavioral_events (
  id TEXT PRIMARY KEY,                    -- Server-assigned nanoid
  event_id TEXT NOT NULL,                 -- Client-submitted idempotency key
  agent_id TEXT NOT NULL,                 -- From AAT sub claim
  timestamp TEXT NOT NULL,                -- Event occurrence time (ISO 8601)
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  resource_type TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  scope_used TEXT,
  metadata_json TEXT,                     -- JSON object, max 10 keys
  session_id TEXT,                        -- Optional grouping
  signed INTEGER NOT NULL DEFAULT 0,      -- 1 if event was cryptographically signed
  source TEXT NOT NULL DEFAULT 'api'      -- 'api' | 'sdk' | 'github_action'
);

-- Primary query: trust engine fetches events for an agent in time range
CREATE INDEX idx_be_agent_ts ON behavioral_events(agent_id, timestamp);

-- Category analysis per agent
CREATE INDEX idx_be_agent_cat ON behavioral_events(agent_id, category, timestamp);

-- Session grouping
CREATE INDEX idx_be_session ON behavioral_events(session_id) WHERE session_id IS NOT NULL;

-- Deduplication check (fast reject of duplicates)
CREATE UNIQUE INDEX idx_be_event_id ON behavioral_events(agent_id, event_id);

-- TTL enforcement (cleanup job)
CREATE INDEX idx_be_received ON behavioral_events(received_at);
```

### 4.2 Aggregation Table

Raw events are retained for 30 days. Daily aggregates are computed and stored indefinitely:

```sql
CREATE TABLE IF NOT EXISTS behavioral_aggregates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  date TEXT NOT NULL,                     -- YYYY-MM-DD
  category TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  denied_count INTEGER NOT NULL,
  timeout_count INTEGER NOT NULL,
  unique_actions INTEGER NOT NULL,        -- Distinct action strings
  avg_duration_ms REAL,
  signed_ratio REAL NOT NULL,             -- Fraction of events that were signed
  UNIQUE(agent_id, date, category)
);

CREATE INDEX idx_ba_agent_date ON behavioral_aggregates(agent_id, date);
```

### 4.3 Data Flow

```
Agent Runtime                    AgentLair Worker                    Trust Engine
─────────────                    ───────────────                    ────────────
                                                                    
 POST /v1/events ──────────────► Validate + Rate Limit              
                                       │                            
                                       ▼                            
                                 D1: behavioral_events (raw, 30d)   
                                       │                            
                                       ▼ (hourly cron)              
                                 D1: behavioral_aggregates (daily)   
                                                                    
                                 ┌──────────────────────────────┐   
  Existing:                      │  audit_log (AgentLair API)   │   
  Auth middleware ──────────────►│  behavioral_events (external) │──► computeTrustProfile()
                                 └──────────────────────────────┘   
```

### 4.4 Trust Engine Integration

The trust engine currently queries ONLY `audit_log`. Phase 2 extends it to ALSO query `behavioral_events`:

```typescript
// trust-engine.ts — Phase 2 modification
async function fetchEvents(db: D1Database, agentId: string, windowDays: number): Promise<AuditEvent[]> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // Merge internal audit events with external behavioral events
  const [internal, external] = await Promise.all([
    db.prepare(`SELECT * FROM audit_log WHERE account_id = ? AND timestamp >= ? ORDER BY timestamp LIMIT 5000`)
      .bind(agentId, cutoff).all(),
    db.prepare(`SELECT * FROM behavioral_events WHERE agent_id = ? AND timestamp >= ? ORDER BY timestamp LIMIT 5000`)
      .bind(agentId, cutoff).all(),
  ]);

  // Normalize external events to AuditEvent interface
  // External events get a distinct actor_type: 'external'
  return mergeAndSort(internal.results, normalizeExternal(external.results));
}
```

**Signal modifications for external events:**
- `telemetry_reporting`: Computed from `event_count / expected_events_per_day` (based on session frequency). Currently hardcoded at 0.5 — becomes live.
- `audit_coverage`: External events INCREASE coverage. More categories represented = higher coverage.
- `scope_utilization`: `scope_used` field feeds directly into scope analysis.
- `escalation_appropriateness`: `escalation` category events are the primary signal.

### 4.5 TTL and Cleanup

A scheduled Worker cron (daily at 03:00 UTC):
1. Aggregate raw events older than 24h into `behavioral_aggregates` (if not already aggregated)
2. Delete raw events from `behavioral_events` where `received_at < now() - 30 days`
3. Trust engine uses raw events when available (recent), falls back to aggregates for older periods

### 4.6 D1 Capacity Planning

D1 limits (per database): 10GB storage, 50M rows max (current tier).

Expected growth per agent:
- Conservative: 100 events/day × 30 days = 3,000 rows per agent
- Aggressive: 5,000 events/day × 30 days = 150,000 rows per agent

At 1,000 active agents (aggressive): 150M rows — exceeds D1 limits. **Mitigation:**
- Partition by time: behavioral_events_{YYYY_MM} tables (monthly rotation)
- Or: move to Cloudflare Analytics Engine for raw events, D1 for aggregates only

For Phase 2 launch (expected <100 active agents): D1 is sufficient. Partition planning is Phase 3 concern.

---

## 5. Privacy Model

### 5.1 Data Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ AGENT CONTROL BOUNDARY                                           │
│                                                                   │
│  Full event context:                                              │
│  - Tool names, parameters, results                                │
│  - Resource paths, sizes, types                                   │
│  - Error messages, stack traces                                   │
│  - Session details, environment info                              │
│                                                                   │
│  ─── SDK strips before submission ───────────────────────────── │
│                                                                   │
│  Submitted to AgentLair:                                          │
│  - Category + action (e.g. "tool.invoke", not "read_password_file")│
│  - Result status (success/failure/denied/timeout)                 │
│  - Duration (latency, not content)                                │
│  - Structural metadata (counts, types, sizes — not content)       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ AGENTLAIR STORAGE (per-account isolation)                         │
│                                                                   │
│  Raw events: behavioral_events table                              │
│  - Visible to: the agent's operator only                          │
│  - API: GET /v1/audit/log (already exists, extended)              │
│  - Retention: 30 days                                             │
│                                                                   │
│  Aggregates: behavioral_aggregates table                          │
│  - Visible to: the agent's operator only                          │
│  - Retention: indefinite                                          │
│                                                                   │
│  ─── Trust engine computes ──────────────────────────────────── │
│                                                                   │
│  Trust profile: trust_profiles table                              │
│  - Score [0,100], confidence [0,1], level, trend                  │
│  - Visible to: anyone via Trust Gate (GET /v1/trust/{agentId})    │
│  - Contains: NO raw events, NO action details, NO metadata        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (crosses boundary)
┌─────────────────────────────────────────────────────────────────┐
│ RELYING PARTIES (other organizations)                             │
│                                                                   │
│  See ONLY: score, level, confidence, computed_at, trend           │
│  See NEVER: raw events, categories, actions, metadata             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Operator Visibility

The agent's operator (authenticated via API key or AAT) can:
- **Read** all raw events for their agent(s) via `GET /v1/audit/log` (existing endpoint, extended to include behavioral_events)
- **Delete** all raw events for an agent (`DELETE /v1/events/{agentId}`) — resets trust to cold-start prior
- **Export** complete event history (`GET /v1/events/export?format=jsonl`)
- **Pause** event ingestion (`PUT /v1/events/config` with `{"ingestion": "paused"}`) — events are rejected during pause; trust score freezes

### 5.3 Platform Visibility

AgentLair platform (internal) can:
- Read raw events for trust computation (automated, no human access)
- Read aggregates for platform-wide analytics (anonymized: agent_id hashed for dashboards)
- **CANNOT** expose raw events to any external party, even under legal request — only aggregated scores and the fact of their computation

### 5.4 ZK-Readiness

The schema is designed for future ZK proof generation:

1. **Commitment scheme:** Each event submission returns a commitment hash. The operator can later prove "I submitted N events in category X with result Y" without revealing the events themselves.

2. **Score derivation proofs:** The trust engine's computation is deterministic given inputs. A ZK circuit can prove "given committed events E1..En, the trust score is S" without revealing E1..En.

3. **Threshold proofs:** "This agent's score exceeds 65" is provable without revealing the exact score — aligns with trust gate `meets_minimum` semantics.

**Phase 2 preparation:** Store a Merkle root of each day's events per agent. This root is the commitment that future ZK proofs verify against.

```sql
-- Added to behavioral_aggregates
ALTER TABLE behavioral_aggregates ADD COLUMN merkle_root TEXT;
```

### 5.5 GDPR / Data Minimization

- **No PII by design.** Events describe agent behavior, not human behavior. Agent IDs are pseudonymous (acc_xxx).
- **Data minimization enforced at schema level.** The event envelope has no freeform text field for content — only structured categories, actions, and bounded metadata.
- **Right to erasure.** `DELETE /v1/events/{agentId}` removes all raw events. Aggregates are retained but anonymized (agent_id replaced with hash).
- **Retention limits.** 30 days raw, aggregates indefinite but content-free (counts only).
- **Consent.** Event submission is opt-in. The agent/operator actively calls the API. No passive collection.

---

## 6. Integration Guide

### 6.1 SDK Extension: @agentlair/verify

Extend the existing `@agentlair/verify` package with a `reportEvents` function:

```typescript
// New export from @agentlair/verify
import { reportEvents, createEventReporter } from '@agentlair/verify';

// One-shot submission
await reportEvents(aat, [
  {
    event_id: nanoid(),
    timestamp: new Date().toISOString(),
    category: 'tool',
    action: 'read_file',
    result: 'success',
    resource_type: 'file',
    duration_ms: 42,
    metadata: { file_type: 'json', bytes: 4096 }
  }
]);

// Session-based reporter (batches automatically)
const reporter = createEventReporter(aat, {
  batchSize: 50,       // Flush every 50 events
  flushInterval: 30_000, // Or every 30 seconds
  sessionId: 'session_abc123',
  onError: (err) => console.warn('Event report failed:', err)
});

reporter.track('tool', 'invoke_api', 'success', { duration_ms: 200 });
reporter.track('resource', 'read_database', 'success', { rows: 42 });
reporter.track('error', 'unhandled_exception', 'failure', { error_code: 'ETIMEOUT' });

// Flush remaining events on shutdown
await reporter.flush();
```

### 6.2 GitHub Action Integration

The existing `agentlair/verify-action` GitHub Action can be extended:

```yaml
# .github/workflows/agent-run.yml
- uses: agentlair/verify-action@v2
  with:
    report-events: true    # Enable event reporting
    session-id: ${{ github.run_id }}
  # Automatically reports:
  # - session.start / session.end
  # - tool.invoke for each step
  # - error.unhandled on step failure
```

### 6.3 MCP Server Integration

For agents running as MCP servers, wrap tool handlers:

```typescript
import { createEventReporter } from '@agentlair/verify';

const reporter = createEventReporter(process.env.AGENTLAIR_AAT);

// Wrap MCP tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const start = Date.now();
  try {
    const result = await originalHandler(request);
    reporter.track('tool', request.params.name, 'success', {
      duration_ms: Date.now() - start
    });
    return result;
  } catch (err) {
    reporter.track('tool', request.params.name, 'failure', {
      duration_ms: Date.now() - start,
      error_code: err.code
    });
    throw err;
  }
});
```

### 6.4 PicoClaw / Claude Agent SDK Integration

For PicoClaw-based agents (our own infrastructure):

```typescript
// In picoclaw container startup
import { createEventReporter } from '@agentlair/verify';

const reporter = createEventReporter(process.env.AGENTLAIR_AAT, {
  sessionId: process.env.SESSION_ID,
  source: 'picoclaw'
});

// Hook into Claude SDK tool_use events
agent.on('tool_use', (event) => {
  reporter.track('tool', event.name, event.error ? 'failure' : 'success', {
    duration_ms: event.duration
  });
});

// Session lifecycle
reporter.track('session', 'start', 'success');
process.on('beforeExit', async () => {
  reporter.track('session', 'end', 'success');
  await reporter.flush();
});
```

---

## 7. Trust Engine Modifications

### 7.1 Signal Changes

| Signal | Current (Phase 1) | Phase 2 (with external events) |
|--------|-------------------|-------------------------------|
| `telemetry_reporting` | Hardcoded 0.5 | `external_event_days / active_days` — measures reporting consistency |
| `audit_coverage` | `log(event_count) / log(expected)` | Includes external events; more categories = higher |
| `scope_utilization` | Categories used in audit_log | Unified across internal + external events |
| `escalation_appropriateness` | Escalation events in audit_log | Primarily from `escalation` category external events |
| `session_regularity` | Sessions from audit_log gaps | Explicit `session.start`/`session.end` events when available |

### 7.2 Weighting Internal vs External Events

External events are self-reported. They deserve less weight than server-side observations:

```typescript
const INTERNAL_WEIGHT = 1.0;   // Observed by AgentLair directly
const EXTERNAL_SIGNED_WEIGHT = 0.85;  // Self-reported but cryptographically signed
const EXTERNAL_UNSIGNED_WEIGHT = 0.7;  // Self-reported, unsigned
```

These weights apply to the `observation_count` used in cold-start calculations and confidence estimation. An agent with 100 external unsigned events has an effective observation count of 70 for trust computation purposes.

### 7.3 Manipulation Resistance (Extended)

New manipulation vectors from self-reported events:

1. **Event fabrication.** Agent reports ideal behavior it didn't actually perform.
   - **Mitigation:** External events alone cannot achieve `principal` level. The trust engine requires a minimum ratio of internal (server-observed) events. Agents that ONLY report external events are capped at `junior`.
   - **Formula:** `max_level = internal_ratio >= 0.2 ? 'principal' : internal_ratio >= 0.1 ? 'senior' : 'junior'`

2. **Selective reporting.** Agent reports successes but not failures.
   - **Mitigation:** Suspiciously low failure rate detection. If `external_failure_rate < 0.01` and `event_count > 100`, apply a 0.9x penalty to consistency (real systems have errors).

3. **Flood and forget.** Agent floods events during setup, then goes silent.
   - **Mitigation:** `telemetry_reporting` signal measures reporting CONSISTENCY over time, not volume. Gap detection penalizes intermittent reporting.

### 7.4 Internal/External Event Ratio Requirements

For trust levels above `junior`, the trust engine enforces:

| ATF Level | Min Internal Events (90d) | Min External Reporting Days | Min Categories |
|-----------|--------------------------|----------------------------|---------------|
| `intern` | 0 | 0 | 0 |
| `junior` | 0 | 0 | 1 |
| `senior` | 10 | 7 | 2 |
| `principal` | 50 | 14 | 3 |

This means an agent cannot reach `principal` without both:
- Meaningful AgentLair API usage (server-observed)
- Consistent external behavioral reporting (self-reported)

---

## 8. Implementation Plan

### Phase 2a: Ingestion Pipeline (Sonnet-level, ~2 days)

1. Create migration `0005_create_behavioral_events.sql`
2. Implement `POST /v1/events` route with validation + rate limiting
3. Add KV-based deduplication (event_id → 1, TTL 24h)
4. Add rate limit counter (agent_id → count, sliding window in KV)
5. Wire into existing audit routes (extend `GET /v1/audit/log` to include external events)

### Phase 2b: Trust Engine Integration (Sonnet-level, ~1 day)

1. Modify `fetchEvents()` to query both tables
2. Implement `telemetry_reporting` live signal
3. Add internal/external weighting
4. Add level cap based on internal ratio
5. Update unit tests

### Phase 2c: SDK Extension (Sonnet-level, ~1 day)

1. Add `reportEvents()` to `@agentlair/verify`
2. Add `createEventReporter()` with batching
3. Publish to npm as minor version bump (0.2.0)
4. Update README with examples

### Phase 2d: PicoClaw Integration (Sonnet-level, ~0.5 day)

1. Add event reporting hook to PicoClaw container bootstrap
2. Report session lifecycle + tool_use events
3. Verify Pico's own trust score improves with reporting

### Phase 3 (Future):

- Aggregation cron worker
- ZK Merkle root computation
- GitHub Action v2 with event reporting
- Cross-org event federation protocol
- Analytics Engine migration for high-volume agents

---

## 9. Open Questions

### 9.1 Event Source Verification

Can we verify that external events are genuine without instrumenting runtimes? Options:
- **Correlation analysis:** Do external session events correlate with AAT issuance times?
- **Challenge-response:** Occasionally query the agent's claimed tool server to verify it exists
- **Operator attestation:** Operator co-signs events, putting reputation at stake

Decision: Defer to Phase 3. For Phase 2, the manipulation resistance measures (7.3) and level caps (7.4) bound the damage from fabricated events.

### 9.2 Event Granularity Guidelines

How granular should events be? One event per tool call? Per batch? Per session?

**Recommendation:** One event per discrete action (tool call, resource access, error). The SDK handles batching for transport efficiency, but conceptually each action is one event. Session-level summaries are valid but yield lower `audit_coverage` scores.

### 9.3 Backward Compatibility

The trust engine currently produces scores for agents with ONLY internal audit data. Adding external events must not degrade existing scores.

**Decision:** External events can only IMPROVE or MAINTAIN scores, never reduce them (for Phase 2 launch). The `telemetry_reporting` signal moves from neutral (0.5) to positive (>0.5) when reporting starts — never below 0.5 for existing agents. Phase 3 may tighten this.

### 9.4 Storage Backend Migration Path

If D1 capacity becomes a constraint, the migration path is:
1. Raw events → Cloudflare Analytics Engine (unlimited time-series, cheaper)
2. Aggregates → remain in D1 (low volume, relational queries)
3. Trust computation reads from Analytics Engine API (slightly higher latency)

This is a Phase 3 concern. Document it now so the schema doesn't preclude it.

---

## 10. References

- [RFC-001] AgentLair as MCP-I Identity Provider (identity, AAT, JWKS)
- [RFC-002] MCP-I Level 4: Behavioral Trust Extension (specification-level requirements)
- [trust-engine.ts] Phase 1 scoring implementation (source of truth for algorithm)
- [middleware/audit.ts] Server-side audit trail (existing ingestion pattern)
- [0001_create_audit_log.sql] D1 schema for internal events
- [0004_create_trust_profiles.sql] D1 schema for computed scores
- [@agentlair/verify] NPM package for AAT verification (extension target)
