/**
 * Cloudflare Pages Direct Upload Deployment Script
 *
 * Replicates the wrangler pages deploy flow using the CF REST API:
 * 1. Hash files using blake3 (same algorithm as wrangler)
 * 2. Get upload token
 * 3. Check which files are missing on CF's side
 * 4. Upload missing files
 * 5. Upsert hashes
 * 6. Create deployment with manifest
 *
 * Uses X-Auth-Email + X-Auth-Key (Global API Key) for deployment creation,
 * and JWT upload tokens for asset operations.
 */

import blake3 from "blake3-wasm";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";
import { config } from "dotenv";
import { runVoiceGate } from "/workspace/tools/voice-check/deploy-voice-gate.ts";
import {
  runFreshnessGate,
  parseGateMode,
} from "/workspace/tools/dist-freshness-gate/dist-freshness-gate.ts";
import {
  runBlogDeployGate,
  commitDeploySnapshot,
  parseOverrideMoratorium,
} from "/workspace/tools/blog-deploy-gate/blog-deploy-gate.ts";

// --- Configuration ---
const SECRETS_PATH = "/workspace/.secrets/cloudflare.env";
const DIST_DIR = join(import.meta.dir, "dist");
const PROJECT_NAME = "agentlair-web";
const CF_API = "https://api.cloudflare.com/client/v4";

// Load secrets
config({ path: SECRETS_PATH });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const AUTH_EMAIL = process.env.CLOUDFLARE_EMAIL!;
const AUTH_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY!;

if (!ACCOUNT_ID || !AUTH_EMAIL || !AUTH_KEY) {
  console.error("Missing Cloudflare credentials in", SECRETS_PATH);
  process.exit(1);
}

// --- File discovery and hashing ---

interface FileEntry {
  path: string; // relative path from dist, e.g. "/index.html"
  absolutePath: string;
  hash: string;
  content: Buffer;
  contentType: string;
  size: number;
}

function getMimeType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".xml": "application/xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Hash a file the same way wrangler does:
 * blake3(base64(contents) + extension).hex().slice(0, 32)
 */
function hashFile(filepath: string): string {
  const contents = readFileSync(filepath);
  const base64Contents = contents.toString("base64");
  const extension = extname(filepath).substring(1); // remove leading dot
  const input = base64Contents + extension;
  return Buffer.from(blake3.hash(Buffer.from(input)))
    .toString("hex")
    .slice(0, 32);
}

function walkDir(dir: string, baseDir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const item of readdirSync(dir)) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...walkDir(fullPath, baseDir));
    } else if (stat.isFile()) {
      const relativePath = "/" + relative(baseDir, fullPath);
      const content = readFileSync(fullPath);
      entries.push({
        path: relativePath,
        absolutePath: fullPath,
        hash: hashFile(fullPath),
        content,
        contentType: getMimeType(fullPath),
        size: stat.size,
      });
    }
  }
  return entries;
}

// --- API helpers ---

function authHeaders(): Record<string, string> {
  return {
    "X-Auth-Email": AUTH_EMAIL,
    "X-Auth-Key": AUTH_KEY,
  };
}

function jwtHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
  };
}

async function cfFetch(
  path: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
): Promise<any> {
  const url = `${CF_API}${path}`;
  const resp = await fetch(url, options);
  const body = await resp.text();

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    console.error(`Non-JSON response from ${path}:`, body.slice(0, 500));
    throw new Error(`CF API returned non-JSON (status ${resp.status})`);
  }

  if (!json.success) {
    console.error(`CF API error for ${path}:`, JSON.stringify(json.errors, null, 2));
    throw new Error(`CF API error: ${json.errors?.[0]?.message || "Unknown error"}`);
  }

  return json.result;
}

// --- Deployment flow ---

async function getUploadToken(): Promise<string> {
  console.log("  Getting upload token...");
  const result = await cfFetch(
    `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/upload-token`,
    { headers: authHeaders() }
  );
  return result.jwt;
}

async function checkMissing(jwt: string, hashes: string[]): Promise<string[]> {
  console.log(`  Checking ${hashes.length} file hashes against CF...`);
  const result = await cfFetch("/pages/assets/check-missing", {
    method: "POST",
    headers: {
      ...jwtHeaders(jwt),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hashes }),
  });
  return result || [];
}

async function uploadFiles(
  jwt: string,
  files: FileEntry[],
  missingHashes: Set<string>
): Promise<void> {
  const toUpload = files.filter((f) => missingHashes.has(f.hash));

  if (toUpload.length === 0) {
    console.log("  All files already cached on CF, no uploads needed.");
    return;
  }

  console.log(`  Uploading ${toUpload.length} files...`);

  // Upload in batches of reasonable size (max 50MB per batch)
  const MAX_BATCH_SIZE = 50 * 1024 * 1024;
  let batch: any[] = [];
  let batchSize = 0;
  let batchNum = 1;

  for (const file of toUpload) {
    const base64Content = file.content.toString("base64");
    const entry = {
      key: file.hash,
      value: base64Content,
      metadata: { contentType: file.contentType },
      base64: true,
    };

    const entrySize = base64Content.length;

    if (batchSize + entrySize > MAX_BATCH_SIZE && batch.length > 0) {
      await uploadBatch(jwt, batch, batchNum++);
      batch = [];
      batchSize = 0;
    }

    batch.push(entry);
    batchSize += entrySize;
  }

  if (batch.length > 0) {
    await uploadBatch(jwt, batch, batchNum);
  }
}

async function uploadBatch(
  jwt: string,
  batch: any[],
  batchNum: number
): Promise<void> {
  console.log(`    Batch ${batchNum}: ${batch.length} files...`);
  await cfFetch("/pages/assets/upload", {
    method: "POST",
    headers: {
      ...jwtHeaders(jwt),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch),
  });
}

async function upsertHashes(jwt: string, hashes: string[]): Promise<void> {
  console.log("  Registering hashes...");
  await cfFetch("/pages/assets/upsert-hashes", {
    method: "POST",
    headers: {
      ...jwtHeaders(jwt),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hashes }),
  });
}

async function createDeployment(
  manifest: Record<string, string>
): Promise<any> {
  console.log("  Creating deployment...");

  const formData = new FormData();
  formData.append("manifest", JSON.stringify(manifest));
  formData.append("branch", "main");
  formData.append("commit_message", `Deploy ${new Date().toISOString()}`);

  const result = await cfFetch(
    `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`,
    {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    }
  );

  return result;
}

// --- Main ---

async function main() {
  // Voice gate — runs BEFORE deploy. --skip-voice to bypass.
  if (!process.argv.includes("--skip-voice")) {
    const gate = runVoiceGate(DIST_DIR);
    if (!gate.passed) {
      process.exit(1);
    }
  }

  // Dist Freshness gate — verifies dist/ is current with src/.
  // Default: stale → exit 1 with FRESHNESS GATE message.
  // --auto-build:        stale → run `bun run build` first → deploy.
  // --skip-build-check:  bypass detection → deploy stale dist (audit-logged).
  // See /workspace/tools/dist-freshness-gate/dist-freshness-gate.ts for the
  // rationale and the recurrence data that motivated this gate (4× violations
  // of agentlair-pipeline/SKILL.md:355 on a single day, 2026-05-05).
  {
    const mode = parseGateMode(process.argv);
    const gate = await runFreshnessGate({ webDir: import.meta.dir, mode });
    if (!gate.passed) {
      process.exit(1);
    }
  }

  // Blog deploy gate — blocks NEW blog posts when SOCIAL thermostat is dampened.
  // Runs after the freshness gate so we evaluate post-rebuild dist/blog/ slugs.
  // Override: --override-moratorium="<reason>". Reason logged to
  // /workspace/memory/state/moratorium-overrides.jsonl. See:
  //   /workspace/tools/blog-deploy-gate/blog-deploy-gate.ts
  // for the recurrence data motivating this gate (3 violations of the
  // 2026-05-06 blog moratorium across 2 days, per CLAUDE.md "Recurring
  // failures need skills … escalate to code enforcement").
  {
    const override = parseOverrideMoratorium(process.argv);
    const gate = await runBlogDeployGate({
      distDir: DIST_DIR,
      override,
    });
    if (gate.blocked) {
      console.error("\n🔴 BLOG-DEPLOY GATE: " + gate.reason + "\n");
      process.exit(1);
    } else if (gate.bypassed) {
      console.log("\n⚠️  BLOG-DEPLOY GATE: " + gate.reason + "\n");
    } else {
      console.log("✅ BLOG-DEPLOY GATE: " + gate.reason);
    }
  }

  console.log(`Deploying ${DIST_DIR} to CF Pages project "${PROJECT_NAME}"...\n`);

  // 1. Discover and hash files
  console.log("[1/5] Scanning files...");
  const files = walkDir(DIST_DIR, DIST_DIR);
  for (const f of files) {
    console.log(`  ${f.path} (${f.size} bytes) -> ${f.hash}`);
  }

  // 2. Build manifest
  const manifest: Record<string, string> = {};
  for (const f of files) {
    manifest[f.path] = f.hash;
  }

  // 3. Get upload token
  console.log("\n[2/5] Getting upload token...");
  const jwt = await getUploadToken();
  console.log("  Token obtained.");

  // 4. Check missing & upload
  console.log("\n[3/5] Checking missing files...");
  const allHashes = files.map((f) => f.hash);
  const missingHashes = await checkMissing(jwt, allHashes);
  console.log(`  ${missingHashes.length} files need uploading.`);

  console.log("\n[4/5] Uploading files...");
  await uploadFiles(jwt, files, new Set(missingHashes));

  // 5. Upsert hashes
  await upsertHashes(jwt, allHashes);

  // 6. Create deployment
  console.log("\n[5/5] Creating deployment...");
  const deployment = await createDeployment(manifest);

  console.log("\n--- Deployment Created ---");
  console.log(`  URL: ${deployment.url}`);
  console.log(`  ID:  ${deployment.id}`);
  console.log(`  Environment: ${deployment.environment}`);
  if (deployment.aliases?.length) {
    console.log(`  Aliases: ${deployment.aliases.join(", ")}`);
  }

  // Persist the blog-slug snapshot AFTER successful deploy. Next deploy
  // diffs against this baseline. Failed deploys (any error before this point)
  // leave the snapshot untouched so a retry sees the same "new" posts.
  try {
    commitDeploySnapshot({ distDir: DIST_DIR });
    console.log("  Blog-deploy snapshot updated.");
  } catch (err: any) {
    console.error(
      "  (warning: failed to update blog-deploy snapshot:",
      err?.message ?? err,
      "— next deploy may re-flag the same posts)"
    );
  }

  // Post-deploy: ping IndexNow so Bing/Yandex/etc. re-index immediately.
  // Non-fatal — a failure here doesn't roll back the deploy.
  if (!process.argv.includes("--skip-indexnow")) {
    console.log("\n[post-deploy] Pinging IndexNow...");
    try {
      const { spawnSync } = await import("child_process");
      const result = spawnSync(
        "bun",
        [join(import.meta.dir, "scripts/indexnow-ping.ts")],
        { stdio: "inherit" }
      );
      if (result.status !== 0) {
        console.error("  (warning: IndexNow ping exited with status", result.status, "— deploy still succeeded)");
      }
    } catch (err: any) {
      console.error("  (warning: IndexNow ping threw:", err?.message ?? err, "— deploy still succeeded)");
    }
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("\nDeployment failed:", err);
  process.exit(1);
});
