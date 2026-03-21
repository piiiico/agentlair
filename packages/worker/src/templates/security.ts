export const SECURITY_BLOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Security at AgentLair \u2014 What We Protect, What We Don't</title>
  <meta name="description" content="A technical overview of AgentLair's security architecture: E2E encryption, encryption at rest, API key auth, vault design, and what we explicitly don't protect against." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #6366f1;
      --accent-dim: #4f52c8;
      --text: #e8e8f0;
      --muted: #888898;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --code-bg: #0d0d17;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.7;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      display: flex; justify-content: space-between; align-items: center;
      padding: 1.25rem 2rem; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px); z-index: 10;
    }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
    .logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    nav .links a:hover { color: var(--text); text-decoration: none; }

    .article { max-width: 720px; margin: 0 auto; padding: 4rem 2rem 6rem; }
    .article-meta { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.5rem; }
    .article h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 1.5rem; }
    .article h1 em { color: var(--accent); font-style: normal; }
    .article-intro { font-size: 1.15rem; color: var(--muted); line-height: 1.7; margin-bottom: 3rem; border-left: 3px solid var(--accent); padding-left: 1.25rem; }

    .article h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 3rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .article h3 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text); }
    .article p { margin-bottom: 1.25rem; }
    .article ul, .article ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
    .article li { margin-bottom: 0.4rem; }
    .article strong { color: #fff; }

    pre {
      background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; overflow-x: auto; margin-bottom: 1.5rem;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted);
    }
    code {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.88em; background: var(--code-bg); padding: 0.15em 0.4em;
      border-radius: 4px; color: var(--accent);
    }
    pre code { background: none; padding: 0; font-size: inherit; color: inherit; }

    .diagram {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.5rem 2rem; margin: 1.5rem 0 2rem; font-family: 'SF Mono', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted); white-space: pre;
      overflow-x: auto;
    }

    .callout {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; margin: 1.5rem 0 2rem;
    }
    .callout-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem; }
    .callout-green .callout-title { color: var(--green); }
    .callout-amber .callout-title { color: var(--amber); }
    .callout-red .callout-title { color: var(--red); }
    .callout p { margin-bottom: 0.5rem; }
    .callout p:last-child { margin-bottom: 0; }

    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0 2rem; font-size: 0.88rem; }
    th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }

    footer { text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 640px) {
      .article { padding: 2rem 1.25rem 4rem; }
      pre { padding: 1rem; font-size: 0.75rem; }
      .diagram { padding: 1rem; font-size: 0.72rem; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><span class="logo-mark">\u26A1</span> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/api">API</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/integrations">Integrations</a>
  </div>
</nav>

<article class="article">

  <p class="article-meta">March 2026 &middot; Security</p>
  <h1>Security at AgentLair: <em>What We Protect and What We Don't</em></h1>

  <div class="article-intro">
    AgentLair handles email and secrets for AI agents. If you're evaluating whether to trust us with your agent's data, this page tells you exactly how security works under the hood \u2014 including the parts we can't protect you from.
  </div>

  <h2>Threat Model</h2>

  <h3>What we protect against</h3>
  <ul>
    <li><strong>AgentLair reading your data.</strong> With E2E encryption enabled, email bodies are encrypted with your public key before storage. We hold ciphertext. We can't read it.</li>
    <li><strong>Data exposure from a KV store breach.</strong> All email bodies are encrypted at rest with a platform-level AES-256-GCM key, even without E2E. An attacker who dumps the store gets encrypted blobs.</li>
    <li><strong>Cross-user data access.</strong> Every API call authenticates via hashed API key and resolves to an <code>account_id</code>. Inbox access, sending, webhooks, and vault operations are all scoped to the authenticated account.</li>
    <li><strong>Credential theft after key compromise.</strong> API keys are SHA-256 hashed before storage. If the key store leaks, attackers get hashes, not keys. You can rotate keys and activate backups instantly via the API.</li>
    <li><strong>Spam and abuse.</strong> Multi-layer rate limiting: per-address daily/hourly/burst limits, bounce-rate suspension, per-account request caps.</li>
  </ul>

  <h3>What we explicitly don't protect against</h3>

  <div class="callout callout-red">
    <div class="callout-title">Honest Limitation</div>
    <p><strong>A fully compromised AgentLair server</strong> can intercept plaintext for new messages \u2014 even with E2E enabled. If an attacker controls the worker code, they could swap out the encryption step and store plaintext instead. E2E protects stored data and protects against passive breaches, but it does not protect against an active attacker who controls the server. This is true of any web service that performs encryption server-side on incoming data.</p>
    <p>Vault secrets are safe in this scenario \u2014 they're encrypted client-side before reaching AgentLair. We never see the plaintext.</p>
  </div>

  <ul>
    <li><strong>Compromised client.</strong> If your agent's runtime is compromised (container escape, stolen env vars), the attacker has your API key and master seed. That's game over for that agent's data \u2014 same as any credential theft.</li>
    <li><strong>Social engineering of recovery emails.</strong> Vault recovery relies on email magic links. If an attacker controls the recovery email account, they can access encrypted vault entries (still encrypted \u2014 they'd need the passphrase to decrypt).</li>
  </ul>

  <h2>E2E Encryption</h2>

  <p>AgentLair offers optional end-to-end encryption for email bodies. When enabled, the server <strong>never sees plaintext</strong> \u2014 bodies are encrypted before storage and can only be decrypted by the agent holding the private key.</p>

  <h3>The crypto stack</h3>

  <table>
    <tr><th>Layer</th><th>Algorithm</th><th>Implementation</th></tr>
    <tr><td>Key exchange</td><td>X25519 ECDH</td><td><code>@noble/curves</code> (audited, no native deps)</td></tr>
    <tr><td>Key derivation</td><td>HKDF-SHA-256</td><td>Web Crypto API</td></tr>
    <tr><td>Encryption</td><td>AES-256-GCM</td><td>Web Crypto API</td></tr>
    <tr><td>RNG</td><td>CSPRNG</td><td><code>crypto.getRandomValues()</code></td></tr>
  </table>

  <h3>How it works</h3>

  <div class="diagram">Agent                                AgentLair
  \u2502                                      \u2502
  \u2502  1. Generate 32-byte master seed     \u2502
  \u2502     (CSPRNG, never sent to server)   \u2502
  \u2502                                      \u2502
  \u2502  2. Derive X25519 key pair           \u2502
  \u2502     HKDF(seed, "agentlair:           \u2502
  \u2502      x25519-keypair:{index}")        \u2502
  \u2502                                      \u2502
  \u2502  3. Register public key  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502  Store public key
  \u2502                                      \u2502
  \u2502               Inbound email arrives  \u2502
  \u2502                                      \u2502  4. Generate ephemeral X25519 key
  \u2502                                      \u2502  5. ECDH(ephemeral, recipient_pub)
  \u2502                                      \u2502  6. HKDF \u2192 AES-256-GCM key
  \u2502                                      \u2502  7. Encrypt body, store ciphertext
  \u2502                                      \u2502
  \u2502  8. GET message  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502
  \u2502  \u25C0\u2500\u2500\u2500  { ciphertext, ephemeral_pub } \u2502
  \u2502                                      \u2502
  \u2502  9. ECDH(private_key, ephemeral_pub) \u2502
  \u2502  10. HKDF \u2192 AES key \u2192 Decrypt       \u2502</div>

  <p>The ciphertext format is compact: <code>[32B ephemeral_pub][12B IV][ciphertext+tag]</code>, base64url-encoded. No custom wire format \u2014 standard primitives, standard serialization.</p>

  <h3>Key rotation without data loss</h3>
  <p>Keys are derived deterministically from a master seed + index. Index 0 is your first key, index 1 is after rotation, and so on. Old keys are retained in your account's key history, so messages encrypted to previous keys remain decryptable. You derive the corresponding private key from the same seed at the old index.</p>

  <div class="callout callout-green">
    <div class="callout-title">Design choice</div>
    <p>We chose X25519 + HKDF + AES-256-GCM because it's the same stack used by Signal and WireGuard. No exotic primitives. The <code>@noble/curves</code> library is audited, has zero dependencies, and runs everywhere \u2014 Cloudflare Workers, Bun, Node, Deno, browsers.</p>
  </div>

  <h2>Encryption at Rest</h2>

  <p>Independently of E2E, <strong>all stored email bodies are encrypted at rest</strong> with a platform-level key using AES-256-GCM. This is a server-side encryption layer \u2014 AgentLair holds the key.</p>

  <p>This protects against:</p>
  <ul>
    <li>KV store breach (attacker dumps data, gets encrypted blobs)</li>
    <li>Accidental data exposure (misconfigured access, logs)</li>
  </ul>

  <p>It does <strong>not</strong> protect against a compromised server (which holds the key). That's what E2E is for.</p>

  <p>When both layers are active, the data path is:</p>

  <pre><code>plaintext \u2192 E2E encrypt (agent's key) \u2192 platform encrypt (server key) \u2192 KV store
KV store \u2192 platform decrypt \u2192 E2E ciphertext \u2192 return to agent \u2192 agent decrypts</code></pre>

  <p>Two independent keys, two independent layers. Compromising one doesn't break the other.</p>

  <h2>API Key Authentication</h2>

  <h3>How keys work</h3>

  <ol>
    <li><code>POST /v1/auth/keys</code> generates a key: <code>al_live_</code> + 32 random characters (CSPRNG)</li>
    <li>The key is SHA-256 hashed. Only the hash is stored in KV.</li>
    <li>The raw key is returned once and never stored server-side.</li>
    <li>Every authenticated request: hash the provided key, look up the hash.</li>
  </ol>

  <p>Key format example: <code>al_live_Ax7bQ9...</code>. The <code>al_live_</code> prefix aids debugging and secret scanning without reducing entropy.</p>

  <h3>Key lifecycle</h3>

  <table>
    <tr><th>Operation</th><th>Endpoint</th><th>What happens</th></tr>
    <tr><td>Create</td><td><code>POST /v1/auth/keys</code></td><td>New account + active key</td></tr>
    <tr><td>Rotate</td><td><code>POST /v1/auth/keys/rotate</code></td><td>Old key revoked, new key active</td></tr>
    <tr><td>Backup</td><td><code>POST /v1/auth/keys/generate-backup</code></td><td>Dormant key, can't auth yet</td></tr>
    <tr><td>Activate backup</td><td><code>POST /v1/auth/keys/activate-backup</code></td><td>Backup \u2192 active, old \u2192 revoked</td></tr>
  </table>

  <p>At most one active key and one backup key exist at any time. Revoked keys are kept in the audit trail but cannot authenticate.</p>

  <h3>User isolation</h3>

  <p>Every resource is namespaced by <code>account_id</code>:</p>

  <ul>
    <li>Email addresses: <code>email-owner:{address} \u2192 account_id</code></li>
    <li>Messages: <code>msg:{address}:{message_id}</code> (address acts as shard, ownership verified on access)</li>
    <li>Vault entries: <code>vault:{account_id}:{key}:{version}</code></li>
    <li>Outbox: <code>outbox:{account_id}:{timestamp}:{msg_id}</code></li>
    <li>Webhooks: scoped by account_id at registration</li>
  </ul>

  <p>There is no admin API, no superuser key, no backdoor. AgentLair operators interact with data only through the same API.</p>

  <h2>Vault: Encrypted Secret Storage</h2>

  <p>Vault is a zero-knowledge secret store for agents. The core principle: <strong>client encrypts, server stores blobs, server never sees plaintext.</strong></p>

  <h3>How it works</h3>

  <ol>
    <li>Your agent generates an encryption key (from a master seed or passphrase).</li>
    <li>Encrypt the secret locally with AES-256-GCM.</li>
    <li><code>PUT /v1/vault/{key}</code> with the ciphertext. AgentLair stores an opaque blob.</li>
    <li><code>GET /v1/vault/{key}</code> returns the blob. Your agent decrypts locally.</li>
  </ol>

  <div class="diagram">Your Agent                        AgentLair Vault
  \u2502                                    \u2502
  \u2502  encrypt(secret) \u2192 ciphertext    \u2502
  \u2502  PUT /v1/vault/my-key  \u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502  store opaque blob
  \u2502                                    \u2502  (cannot decrypt)
  \u2502  GET /v1/vault/my-key  \u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502
  \u2502  \u25C0\u2500\u2500  ciphertext                  \u2502
  \u2502  decrypt(ciphertext) \u2192 secret    \u2502</div>

  <h3>Recovery</h3>

  <p>When everything fails \u2014 container destroyed, API key lost, agent gone \u2014 recovery works through a registered email:</p>

  <ol>
    <li><code>POST /v1/vault/recover</code> with your recovery email address</li>
    <li>AgentLair sends a single-use magic link (15 minute TTL)</li>
    <li>The link returns all your encrypted vault entries</li>
    <li>Decrypt with your passphrase or master seed</li>
    <li>Spin up a new agent with recovered secrets</li>
  </ol>

  <p>No support ticket. No human at AgentLair involved. The recovery endpoint returns the same response regardless of whether the email exists \u2014 no enumeration possible.</p>

  <div class="callout callout-green">
    <div class="callout-title">Key point</div>
    <p>Recovery returns encrypted blobs. Even if an attacker compromises the recovery email, they still need the passphrase or master seed to decrypt the secrets. This is defense in depth \u2014 email compromise alone is not enough.</p>
  </div>

  <h3>Recommended client-side crypto</h3>

  <p>We document (but don't enforce) a recommended encryption scheme:</p>

  <ul>
    <li><strong>Master seed:</strong> 32 bytes from CSPRNG</li>
    <li><strong>Per-secret key:</strong> <code>HKDF-SHA256(master_seed, key_name)</code> \u2192 32-byte AES key</li>
    <li><strong>Encryption:</strong> AES-256-GCM with random 12-byte IV</li>
    <li><strong>Seed backup:</strong> Encrypt master seed with a passphrase via PBKDF2 (600,000 iterations). Store the encrypted seed in Vault under <code>_master_seed_backup</code>.</li>
  </ul>

  <p>Use whatever crypto you trust. Vault stores opaque bytes \u2014 it doesn't care about the algorithm.</p>

  <h2>Rate Limiting &amp; Abuse Prevention</h2>

  <table>
    <tr><th>Limit</th><th>Free tier</th><th>Pro tier</th></tr>
    <tr><td>Emails per day</td><td>10</td><td>1,000</td></tr>
    <tr><td>Emails per hour</td><td>5</td><td>200</td></tr>
    <tr><td>Burst (per minute)</td><td>3</td><td>60</td></tr>
    <tr><td>API requests per day</td><td>100</td><td>10,000</td></tr>
    <tr><td>Bounce rate threshold</td><td colspan="2">&gt;10% after 10 sends \u2192 suspended</td></tr>
  </table>

  <p>All limits are tracked per-address (email) or per-account (API). Bounce rate suspension is automatic \u2014 addresses with high bounce rates are blocked for 30 days. This protects AgentLair's deliverability reputation, which protects every agent using the platform.</p>

  <h2>What's Not Covered</h2>

  <p>Transparency means saying the quiet parts out loud:</p>

  <ul>
    <li><strong>No end-to-end encryption for metadata.</strong> Email subjects, sender/recipient addresses, and timestamps are stored in plaintext. E2E covers the body only. This is a deliberate trade-off \u2014 metadata enables inbox listing, search, and webhooks.</li>
    <li><strong>No forward secrecy.</strong> If your master seed is compromised, all past messages encrypted with keys derived from it can be decrypted. The deterministic key derivation that enables key rotation and recovery is the same property that prevents forward secrecy.</li>
    <li><strong>Cloudflare is in the trust chain.</strong> AgentLair runs on Cloudflare Workers. Cloudflare terminates TLS and could theoretically inspect traffic. If your threat model excludes Cloudflare, AgentLair isn't the right choice.</li>
    <li><strong>Vault metadata is not encrypted.</strong> The <code>metadata</code> field on vault entries (labels, algorithm hints) is stored in plaintext. Never put sensitive information in metadata.</li>
  </ul>

  <h2>Infrastructure</h2>

  <table>
    <tr><th>Component</th><th>Provider</th><th>Purpose</th></tr>
    <tr><td>Compute</td><td>Cloudflare Workers</td><td>API + email processing</td></tr>
    <tr><td>Storage</td><td>Cloudflare KV</td><td>Keys, emails, vault entries</td></tr>
    <tr><td>Email delivery</td><td>Resend</td><td>Outbound SMTP (DKIM/SPF/DMARC)</td></tr>
    <tr><td>Email reception</td><td>Cloudflare Email Routing</td><td>Inbound MX handling</td></tr>
    <tr><td>TLS</td><td>Cloudflare</td><td>Automatic HTTPS</td></tr>
  </table>

  <p>There are no databases, no VMs, no containers to patch. The entire service is a single Cloudflare Worker with KV storage. The attack surface is small by design.</p>

  <h2>Reporting Security Issues</h2>

  <p>Found something? Email <a href="mailto:security@agentlair.dev">security@agentlair.dev</a>. We take reports seriously and will respond within 48 hours. If you've found a data isolation or authentication bypass, we'd rather hear about it from you than discover it ourselves.</p>

</article>

<footer>
  <p>&copy; 2026 AgentLair &mdash; Email for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/">Home</a> &nbsp;&middot;&nbsp;
    <a href="/api">API</a> &nbsp;&middot;&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;&middot;&nbsp;
    <a href="/integrations">Integrations</a> &nbsp;&middot;&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

</body>
</html>`;
