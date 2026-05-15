# Deploy Output: agentlair-trust-epistemic-integrity-20260515

**Phase 2.5 Component 6 — `computeEpistemicIntegrity` scorer**
**Deployed:** 2026-05-15
**Task ID:** 46282740fbeb438d

## Commit

`1a64cf55a35bf2239a6bd411285dc54f37eb2773`

## Bundle Delta

| Asset | Size |
|---|---|
| `index.js` | 8.33 MB |
| `index_bg-904m1xk3.wasm` | 2.48 MB |
| `inter-regular-trkw105r.woff2` | 48.44 KB |
| `inter-bold-v54wecxs.woff2` | 49.56 KB |

Delta: small additive increase for ~354 LOC pure leaf module — expected and within sanity range.

## Worker Version

Edge confirmed serving `1a64cf55a35bf2239a6bd411285dc54f37eb2773` — match on first poll (860ms).

## Smoke Probes

| Probe | Expected | Actual | Pass |
|---|---|---|---|
| `GET /api` | 200 JSON | 200 JSON (OpenAPI 3.1.0, v0.18.3) | ✅ |
| `POST /v1/audit/log` (no auth) | 401 | 401 | ✅ |

C5 `action_stream` substrate regression guard: passing.

## Fitness

No `fitness[]` field in pipeline manifest — `run-fitness.ts` exited 0 silently. Expected per spec.

## Notes

- No D1 migrations: `find migrations -newer manifest.json -type f` → zero results.
- C6 is a **leaf module** — not wired into `computeTrustScore`. No live callers. C10 will activate it.
- No fitness assertions possible until C10 mounts the scorer.
- CDN cache purged (full zone purge).
