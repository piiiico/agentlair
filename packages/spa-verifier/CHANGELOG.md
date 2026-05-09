# Changelog

All notable changes to `@agentlair/spa-verifier` are documented here.

## [0.2.0] — 2026-05-06

### Added
- GitHub Actions example workflow (`examples/github-actions/verify-skill.yml`) — detects changed skill directories on a PR, verifies each, posts a comment summary, and blocks merge on failure
- README: CI Integration section with inline GitHub Actions snippet, trimmed 5-line quick-start, and collapsible GitLab CI equivalent
- `examples/` directory included in the published package

### Changed
- CLI `--version` now reports `0.2.0`

### No API changes
Zero breaking changes from 0.1.0. All existing `verifySpa`, `verifySpaJwt`, `computeDigest`, `parseSpaToken`, and `readSkillDir` signatures are unchanged.

---

## [0.1.0] — 2026-05-06

Initial release. Ed25519/JWS verifier for Skill Provenance Attestations. Zero dependencies, Web Crypto, runs in Node, Bun, Deno, Cloudflare Workers, Vercel Edge.
