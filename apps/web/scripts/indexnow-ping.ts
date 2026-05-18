#!/usr/bin/env bun
/**
 * IndexNow submission — pings Bing / Yandex / Seznam / Naver with our URLs.
 *
 * Protocol: https://www.indexnow.org/documentation
 * Endpoint: POST https://api.indexnow.org/IndexNow
 *
 * Key file is served at https://agentlair.dev/<key>.txt (static asset in public/).
 *
 * What we submit on every deploy:
 * - All URLs discovered via sitemap-index.xml (resolves to sitemap-0.xml etc.)
 *
 * Usage:
 *   bun scripts/indexnow-ping.ts                  # ping all sitemap URLs
 *   bun scripts/indexnow-ping.ts --dry-run        # print payload, do not POST
 *   bun scripts/indexnow-ping.ts --url https://agentlair.dev/foo  # ping single URL
 *
 * Per IndexNow spec: max 10,000 URLs per request. We chunk if needed.
 */

const HOST = "agentlair.dev";
const KEY = "517b7d1c13cd31d3ce579244597cbfeb";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";
const SITE = `https://${HOST}`;
const MAX_BATCH = 10_000;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

// --url <single-url> override (single-URL ping path)
let singleUrl: string | null = null;
{
  const idx = process.argv.indexOf("--url");
  if (idx > -1 && process.argv[idx + 1]) singleUrl = process.argv[idx + 1];
}

async function fetchSitemapUrls(sitemapPath: string): Promise<string[]> {
  const res = await fetch(`${SITE}${sitemapPath}`);
  if (!res.ok) {
    console.warn(`  sitemap fetch failed ${sitemapPath}: ${res.status}`);
    return [];
  }
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls;
}

/** Resolve all leaf sitemap URLs from the sitemap-index. */
async function collectAllUrls(): Promise<string[]> {
  // Fetch the index to find child sitemaps
  const res = await fetch(`${SITE}/sitemap-index.xml`);
  if (!res.ok) {
    console.warn(`  sitemap-index fetch failed: ${res.status} — trying /sitemap-0.xml directly`);
    return fetchSitemapUrls("/sitemap-0.xml");
  }
  const indexXml = await res.text();
  // Extract child sitemap locations
  const childSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.includes("sitemap")); // skip if index has page locs

  if (childSitemaps.length === 0) {
    // sitemap-index has no child sitemaps — try fallback
    console.warn("  sitemap-index has no child sitemaps, falling back to /sitemap-0.xml");
    return fetchSitemapUrls("/sitemap-0.xml");
  }

  const urls: string[] = [];
  for (const sitemapUrl of childSitemaps) {
    // Convert absolute URL to path for fetchSitemapUrls
    const path = sitemapUrl.replace(SITE, "");
    console.log(`  Fetching ${path}…`);
    const batch = await fetchSitemapUrls(path);
    console.log(`    +${batch.length} URLs`);
    urls.push(...batch);
  }
  return urls;
}

async function verifyKeyServed(): Promise<boolean> {
  const res = await fetch(KEY_LOCATION);
  if (!res.ok) return false;
  const body = (await res.text()).trim();
  return body === KEY;
}

async function submit(urlList: string[]): Promise<{ ok: boolean; status: number; body: string }> {
  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };
  if (dryRun) {
    console.log("[dry-run] would POST:");
    console.log(JSON.stringify(payload, null, 2).slice(0, 800));
    if (JSON.stringify(payload).length > 800) console.log("…(truncated)");
    return { ok: true, status: 0, body: "dry-run" };
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok || res.status === 202, status: res.status, body };
}

async function main() {
  console.log(`IndexNow ping → ${HOST}`);

  if (!dryRun) {
    const keyOk = await verifyKeyServed();
    if (!keyOk) {
      console.error(`✗ key file not served at ${KEY_LOCATION} — fix that first`);
      process.exit(1);
    }
    console.log(`✓ key verified at ${KEY_LOCATION}`);
  }

  // Single URL path
  if (singleUrl) {
    if (!singleUrl.startsWith(SITE)) {
      console.error(`✗ url must be on ${SITE}: ${singleUrl}`);
      process.exit(1);
    }
    const result = await submit([singleUrl]);
    console.log(`  → ${result.status} ${result.body || "(empty)"}`);
    process.exit(result.ok ? 0 : 1);
  }

  // Bulk path: gather all sitemap URLs
  console.log("Collecting URLs from sitemap-index.xml…");
  const urls = await collectAllUrls();

  // Dedup
  const unique = [...new Set(urls)];
  console.log(`Total unique URLs: ${unique.length}`);

  if (unique.length === 0) {
    console.error("✗ no URLs to submit");
    process.exit(1);
  }

  // Chunk and submit
  let anyFailed = false;
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const batch = unique.slice(i, i + MAX_BATCH);
    console.log(`Submitting batch ${Math.floor(i / MAX_BATCH) + 1} (${batch.length} URLs)…`);
    const result = await submit(batch);
    console.log(`  → ${result.status} ${result.body.slice(0, 200) || "(empty)"}`);
    if (!result.ok) anyFailed = true;
  }

  if (anyFailed) {
    console.error("✗ at least one batch failed");
    process.exit(1);
  }
  console.log("✓ IndexNow submission complete");
}

main().catch((err) => {
  console.error("✗ indexnow-ping failed:", err);
  process.exit(1);
});
