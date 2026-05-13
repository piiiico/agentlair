// AUTO-OVERWRITTEN by /workspace/tools/agentlair-deploy.ts at build time.
// The values committed here are placeholders for local dev and test runs only.
// At deploy time the deploy script rewrites this file in the worktree to bake
// in the target commit SHA and deployment timestamp — those values are then
// served by GET /__build so the deploy can verify edge propagation.
//
// Do NOT import these for any logic; they exist solely for the edge-verification
// gate. If you need richer build metadata, add a new field and update both the
// deploy script and the /__build route together.
export const BUILD_COMMIT = 'dev';
export const BUILD_DEPLOYED_AT = '1970-01-01T00:00:00.000Z';
