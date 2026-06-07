# Changelog

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
