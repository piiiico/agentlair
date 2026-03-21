#!/usr/bin/env bun
const CF_EMAIL = "pico@amdal.dev";
const CF_KEY = "17f300ee284aed62f86bee19d75da163b0220";
const CF_ACCOUNT = "1e3b03e4a8d2514f89998dbdda7d5140";
const WORKER_NAME = "agentlair-api";

const workerCode = await Bun.file("/workspace/agentlair-worker/dist/index.js").text();
const boundary = "boundary" + Date.now();

const metadata = {
  main_module: "index.js",
  bindings: [
    { type: "kv_namespace", name: "KEYS", namespace_id: "e7125ab59c3e44e68e9b6496d47ac83d" },
    { type: "kv_namespace", name: "EMAILS", namespace_id: "0c16b7fe8a09430fb3e7c21c70f9544f" },
    { type: "kv_namespace", name: "VAULT", namespace_id: "5eb916dd7125415da51c15cd85c3b761" },
    { type: "analytics_engine", name: "AE_ANALYTICS", dataset: "agentlair_events" },
    { type: "durable_object_namespace", name: "INBOX_NOTIFIER", namespace_id: "ed86c0465f714bc8978398fc80cf8d68" },
  ],
  compatibility_date: "2024-01-01",
};

const body = [
  `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
  `--${boundary}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n${workerCode}\r\n`,
  `--${boundary}--\r\n`,
].join("");

console.log(`Deploying ${WORKER_NAME} (bundled dist) with Analytics Engine...`);

const resp = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}`,
  {
    method: "PUT",
    headers: {
      "X-Auth-Email": CF_EMAIL,
      "X-Auth-Key": CF_KEY,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  }
);

const data = await resp.json() as any;
console.log("Status:", resp.status, "| Success:", data.success);
if (!data.success) {
  console.log("Errors:", JSON.stringify(data.errors, null, 2));
  process.exit(1);
}
console.log(`✅ agentlair-api deployed with AE binding (dataset: agentlair_events)`);
