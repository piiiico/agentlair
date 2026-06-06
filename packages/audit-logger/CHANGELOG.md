# Changelog

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
