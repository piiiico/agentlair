# Changelog

## [0.6.0] - 2026-06-12

### New Features — canonicalizer accountability ("trust the caller's hash function" becomes checkable)

v0.5 made the receipt commit to *what* the call meant via `approvedEnvelopeHash`. v0.6 makes it commit to *who decided what counts as a meaning*. The canonicalizer is no longer implementation detail — it is a trust boundary, and the chain proves three contracts independently:

- `canonicalizerProfileHash` — declares what the canonicalizer preserves (`includedConsequentialFields`, `excludedFields`, `normalizationRules`).
- `policySurfaceHash` — declares what the policy depends on (`gatedFields`).
- `policyProfileBindingHash` — proves the two fit, registered out-of-band before authority is minted.

The decomposition (rpelevin's three-digest model, vercel/ai#13215 comment 4686858517) keeps these claims independently checkable: canonicalizer drift, policy drift, and compatibility drift each surface as their own break category.

### Types added

- `CanonicalizerProfile` — `{ profileId, version, toolFamily, includedConsequentialFields, excludedFields, normalizationRules, profileHash }`. Pure data. No environment lookup. `migrationVerifier?: { fromVersion, toVersion }` for cross-version replay metadata.
- `PolicySurface` — `{ policyRef, gatedFields, surfaceHash }`.
- `PolicyProfileBinding` — `{ policySurfaceHash, canonicalizerProfileHash, bindingHash }`. Compatibility proof.
- `PolicyProfileBindingRegistry` — `{ register(surface, profile), lookup(surfaceHash, profileHash) }`. Default `InMemoryPolicyProfileBindingRegistry` exported.

Hash helpers exported:
- `computeCanonicalizerProfileHash(profileWithoutHash)`
- `computePolicySurfaceHash(surfaceWithoutHash)`
- `computePolicyProfileBindingHash(surfaceHash, profileHash)`

### `beginAction()` — pre-authority refusal as a first-class concept

When called with `canonicalizerProfile + policySurface + bindingRegistry`, `beginAction()` enforces three refusal cases BEFORE any AAR is minted. Each throws a `BeginActionRefusal` with a machine-readable `reason` code — pre-authority refusals do not produce a record because there is no authority to terminate.

| Reason | Trigger |
|---|---|
| `unbound_policy_profile` | No registered binding for (`policy.surfaceHash`, `profile.profileHash`). |
| `profile_data_incomplete` | Profile declares a normalization rule for a field absent from the envelope (or absent from `includedConsequentialFields` at registration). |
| `policy_surface_unbound` | At `registry.register()`, the policy gates on a field absent from `profile.includedConsequentialFields`. Surfaces during registration, never reaches `beginAction`. |

This is rpelevin's naming refinement adopted: `profile_incompatible` as a terminal reason is reserved strictly for drift *after* authority is minted. Pre-authority refusal gets its own reason codes.

### `endAction()` — terminal profile binding

When `preAction.canonicalizerProfileHash` is set and `phase === 'executed'`:
- `canonicalizerProfile` argument is REQUIRED. Omitting throws.
- `profile.profileHash` MUST equal `preAction.canonicalizerProfileHash`. Mismatch throws with `profile_incompatible` — authority was minted under profile A but execution sealed against profile B. The legal path is `phase: 'cancelled'`, `terminalReason: 'profile_incompatible'`, followed by a new `beginAction()` under the new profile.

The terminal carries its own `canonicalizerProfileHash` so the chain pins both ends.

### `verifyChain()` — three new break categories

- `canonicalizerProfileHash in registeredCanonicalizerProfiles` — when the verifier supplies `registeredCanonicalizerProfiles`, any pre-action whose `canonicalizerProfileHash` is not in the set is rejected (`unregistered_canonicalizer_profile`). BYO canonicalizers cannot launder unknown hashes through the chain.
- `canonicalizerProfileHash === pre.canonicalizerProfileHash` — terminal drift, sibling of `effectiveEnvelopeHash === approvedEnvelopeHash` from v0.5.
- `migration_preserves_policy_surface` — `migrationVerifiers` entries now accept either a bare function (v0.5 form, preserved) or `{ migrate, preservesPolicySurface }`. When `preservesPolicySurface !== true`, cross-version replay is rejected with `migration_changes_policy_surface`. Captures the migration-that-changes-the-policy-surface case: a migration whose output surface differs from input requires a fresh approval cycle, not silent replay.

### Tests

Seven negative tests + one happy path for the v0.6 gate:
0. `unbound_policy_profile` — `beginAction` refuses when no binding registered.
1. `policy_surface_unbound` — `registry.register` refuses when policy gates on a field the profile excludes.
2. `profile_data_incomplete` — `beginAction` refuses when profile declares normalization for a field absent from the envelope.
3. Terminal profile mismatch — `endAction` throws when `canonicalizerProfile.profileHash !== preAction.canonicalizerProfileHash`.
4. Migration changes policy surface — `verifyChain` rejects cross-version replay through a migration declared `preservesPolicySurface: false`.
5. BYO unregistered profile — `verifyChain` rejects pre-actions whose `canonicalizerProfileHash` is absent from `registeredCanonicalizerProfiles`.
6. Happy path — full three-hash chain verifies intact when binding registered and profile preserved across pre→terminal.

### Migration

- Field additions are non-breaking. v0.5 code that does not pass `canonicalizerProfile` / `policySurface` / `bindingRegistry` is unaffected.
- `migrationVerifiers` value type is widened (function | object). Existing bare-function entries still work.
- Callers that want canonicalizer accountability: pass all three to `beginAction()`, and `canonicalizerProfile` to `endAction()`.

### Design Notes

- `canonicalizerProfile` is **pure data**. No host environment lookup. The fs profile cannot ask the host "are you case-sensitive" at runtime — that answer is host-state, not envelope-state, and host migration silently invalidates replay. Normalization assumptions go into `normalizationRules` as declared data; changing them is a new profile id, not the same profile in a new environment.
- **Binding-hash registry, not recompute.** `policyProfileBindingHash` is a pure function of `(surfaceHash, profileHash)`, so the compatibility check runs once at registration. `beginAction()` does a binding lookup, not a compatibility recheck — keeps the hot path constant-time and makes "no binding registered" a structural refusal. No silent auto-compatibility because someone forgot to declare otherwise.
- **Refusal asymmetry honored.** `beginAction` refusals produce no AAR (there is no authority to terminate). Terminal `profile_incompatible` only describes drift after authority was minted.

## [0.5.0] - 2026-06-12

### New Features — envelope binding ("make invalid histories structurally hard to write" continued)

v0.5 splits the receipt's hash commitments into two related identities of the call:

- `AARPreAction.approvedEnvelopeHash` — SHA-256 of the canonical envelope (consequential call shape) shown for approval.
- `AARTerminalReceipt.effectiveEnvelopeHash` — SHA-256 of the canonical envelope at execution time.
- `canonicalizationVersion` on both records, so the verifier can fail closed on cross-version replay unless an explicit migration is selected. v0.5 ships `'cv1'`.
- `inputDigest` is unchanged — it remains as evidence of the literal payload, not the authority gate.

`beginAction()` now accepts:
- `canonicalInput?: unknown` — the consequential subset (tool name, target, arguments, scope, actor, policy/approval refs, execution-affecting defaults). When supplied, the pre-action carries `approvedEnvelopeHash` and `canonicalizationVersion`.
- `canonicalizationVersion?: string` — defaults to `'cv1'` when `canonicalInput` is set.

`endAction()` now accepts:
- `effectiveCanonicalInput?: unknown` — required when `preAction.approvedEnvelopeHash` is set AND `phase === 'executed'`.
- `canonicalizationVersion?: string` — defaults to the pre-action's stored version; cross-version sealing throws.

**Sign-time invariants enforced at `endAction()`:**
- `phase: 'executed'` with `effectiveEnvelopeHash !== preAction.approvedEnvelopeHash` throws. The error message names the legal path: `phase: 'cancelled'` with `terminalReason: 'effective_call_changed'`, followed by a *new* `beginAction()` for the mutated envelope.
- `phase: 'executed'` without an `effectiveCanonicalInput` against a v0.5 pre-action throws.
- Cross-version sealing (`canonicalizationVersion` mismatch between pre-action and terminal) throws.

### `verifyChain()` — envelope-aware

`verifyChain()` now accepts a second argument `VerifyChainOptions`:

- `replayedCanonicalInputs?: Record<preActionId, unknown>` — when supplied, the verifier recomputes `approvedEnvelopeHash` from each replayed envelope; mismatch is reported as `expected: 'approvedEnvelopeHash matches replay'` (approved-envelope drift).
- `replayedRawInputs?: Record<preActionId, unknown>` — recomputes `inputDigest`; mismatch is reported as `expected: 'inputDigest matches replay'` (raw-input byte drift).
- `canonicalizationVersion?: string` — verifier's intended replay version. Cross-version replay fails closed unless `migrationVerifiers[receiptVersion]` provides an explicit migration function.
- `migrationVerifiers?: Record<sourceVersion, (value) => unknown>` — permits cross-version replay.

The verifier now distinguishes three drift categories via distinct `expected` strings on `breaks`:
- `effectiveEnvelopeHash === approvedEnvelopeHash (...)` — effective-envelope drift (detectable without replay; both hashes are on the receipts).
- `approvedEnvelopeHash matches replay` — approved-envelope drift (requires `replayedCanonicalInputs`).
- `inputDigest matches replay` — raw-input byte drift (requires `replayedRawInputs`).

Plus a v0.5 chain rule:
- A `cancelled` terminal with `terminalReason: 'effective_call_changed'` followed by a `beginAction()` that reuses the cancelled pre-action's `policyRef` is reported as `expected: 'policyRef differs from cancelled pre-action ... (effective_call_changed)'`. A different envelope is a different decision — the new approval cycle must reference a new policy decision.

### Tests

Six negative tests covering the v0.5 gate:
1. Metadata-only provider normalization preserves envelope-hash equality.
2. Target change rejects `executed`; `cancelled` with `effective_call_changed` is the legal path; a new `beginAction()` is an independent cycle.
3. Execution-time defaults that change effect are rejected.
4. PolicyRef carryover into a new `beginAction()` after `effective_call_changed` is detected by `verifyChain()`.
5. Verifier distinguishes approved-envelope, effective-envelope, and raw-input drift via three distinct `expected` strings.
6. Cross-version replay fails closed; explicit migration verifier permits it.

### Migration

- Field additions are non-breaking. Existing v0.4 code that does not pass `canonicalInput` is unaffected — only `inputDigest` continues to be the bound identity.
- Callers that want envelope binding: pass `canonicalInput` to `beginAction()` and `effectiveCanonicalInput` to `endAction()`.
- Drift handling: pivot to `phase: 'cancelled'`, `terminalReason: 'effective_call_changed'`, then open a new `beginAction()` with a *different* `policyRef`. Reusing the cancelled policyRef is a verify-time break.

### Design Notes

- `inputDigest` is preserved as evidence, not authority. "Exact-call binding is not exact-bytes binding" — the gate is over the meaning of the call, not the byte stream. Provider normalization that injects non-consequential metadata (trace headers, transport retry IDs, defaulted timeouts that don't change effect) doesn't trip the gate when the caller computes `canonicalInput` correctly.
- Canonical-envelope derivation is the caller's responsibility. The library accepts both `input` (raw) and `canonicalInput` (consequential subset) and hashes them separately. A future minor version may ship default canonicalizers for common transports (HTTP, fs, db) — for now the contract is "caller derives, library hashes."
- The verifier's three drift categories let downstream tooling route each appropriately: approved-envelope drift implies tampering with stored envelopes (rotate keys, investigate operator); effective-envelope drift implies the executor deviated from approval (audit the agent); raw-input byte drift implies the literal payload was rewritten (replay attack, retry-storm log corruption).

## [0.4.2] - 2026-06-07

### Documentation
- README-only update — no API changes
- Added "Local-only vs hosted AgentLair" section explaining when to add `AGENTLAIR_API_KEY`
- Per-tier retention, verification, and EU AI Act Article 12 framing
- Direct links to `/pricing` and `/register` for the hosted side

## [0.4.1] - 2026-06-07

### Documentation
- README-only refresh — no API changes
- Aligned npm README with deployed docs page (agentlair.dev/docs/audit-logger)
- `beginAction` / `endAction` AAR split is now the top-level primary API, not a footnote
- Added full `endAction` parameter table with `phase`, `terminalAt`, `terminalReason`
- Documented sign-time invariants: executed-over-denied throws; executed past expiresAt throws
- Added terminal phase enum table and chain mechanics diagram
- Kept `auditLog()` section as a 'Lightweight logging' alternative

## [0.4.0] - 2026-06-06

### New Features
- `AARPreAction.expiresAt` — optional ISO 8601 UTC timestamp marking the authority deadline for executing this tool call. Covered by `previousReceiptHash` (canonical-JSON hash of the whole pre-action), so tampering with `expiresAt` after signing breaks the chain.
- `beginAction()` accepts `expiresAt?: string | Date` and embeds it in the pre-action.
- `endAction()` sign-time invariant: `phase === 'executed'` throws when `executionEndedAt > preAction.expiresAt` (falls back to `now` if `endedAt` is omitted). Refuses to mint a receipt that claims authorized execution past the deadline.
- `verifyChain()` authority check:
  - `phase === 'expired'` terminal MUST have a pre-action whose `expiresAt` is set and whose `terminalAt >= expiresAt`.
  - `phase === 'executed'` terminal whose `executionEndedAt > preAction.expiresAt` is reported as a `chainIntegrity: 'broken'` break. Catches historical chains written pre-v0.4 that violate the new invariant.

### Migration
- Field addition is non-breaking. Existing code that does not pass `expiresAt` is unaffected.
- Callers that want authority enforcement: pass `expiresAt` to `beginAction()` and choose `phase: 'expired'` (with appropriate `terminalAt` / `endedAt`) when the authority window elapses before execution finishes.

### Design Notes
- Late-executed enforcement runs **only at sign time** (when the logger holds the pre-action and HMAC key) and **at verify time** (when the verifier inspects the chain). v0.4 does NOT introduce a watchdog process — operators who need cancellation can build one on top.
- Clock-skew handling is intentionally absent from `verifyChain()`. Verifiers that need a grace window can wrap the result and downgrade authority breaks within `(0, ε]` of `expiresAt`. The invariant inside the package is strict.
- `closedBy` field is NOT added in this release; held pending further discussion on vercel/ai#13215.

## [0.3.0] - 2026-06-06

### Breaking Changes
- `AARPostAction` is replaced by `AARTerminalReceipt`. `AARPostAction` remains as a deprecated type alias.
- `endAction()` now returns `Promise<AARTerminalReceipt>` instead of `Promise<AARPostAction>`
- `endAction()` now accepts `phase` parameter (defaults to `'executed'`)
- `verifyChain()` now accepts `Array<AARPreAction | AARTerminalReceipt>` and checks that every pre-action has a terminal receipt
- Sign-time invariant: `endAction()` throws if `phase === 'executed'` and `preAction.approvalDecision === 'denied'`

### New Features
- Phase enum: `executed | failed | denied | expired | cancelled`
- `terminalAt` field (always present, replaces implicit `executionEndedAt` for non-execution phases)
- `terminalReason` optional field for human-readable explanation
- `resultDigest` replaces `outputDigest` (functionally identical)
- Denied/expired/cancelled terminals participate in the hash chain
- `verifyChain()` returns `chainIntegrity: 'incomplete'` when a pre-action has no terminal receipt

### Migration
- Replace `AARPostAction` type references with `AARTerminalReceipt`
- `endAction()` return type is now `AARTerminalReceipt`; access `resultDigest` instead of `outputDigest`
- `executionMs` is removed; compute from `executionStartedAt`/`executionEndedAt` if needed
- For denied calls, call `endAction({ preAction, phase: 'denied', terminalReason: '...' })` — do NOT call with `phase: 'executed'`
- `startedAt` and `endedAt` are now optional; omit them for non-execution phases (denied, expired, cancelled)

## [0.2.0]

Initial AAR (Agent Action Record) split with `AARPreAction` / `AARPostAction` and hash-chain verification.
