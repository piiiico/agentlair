import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ─── Code Tabs ─── */

type Lang = "curl" | "typescript" | "python";

function CodeTabs({
  group,
  tabs,
}: {
  group: string;
  tabs: { lang: Lang; label: string; code: string }[];
}) {
  const [active, setActive] = useState(0);

  return (
    <div className="overflow-hidden rounded-xl border bg-[oklch(0.13_0_0)] shadow-md">
      <div className="flex gap-0 border-b border-white/10">
        {tabs.map((t, i) => (
          <button
            key={`${group}-${t.lang}`}
            onClick={() => setActive(i)}
            className={cn(
              "px-4 py-2.5 font-mono text-xs transition-colors",
              i === active
                ? "bg-[oklch(0.18_0_0)] text-white"
                : "text-white/50 hover:text-white/80"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-white/90">
        <code>{tabs[active].code}</code>
      </pre>
    </div>
  );
}

/* ─── Endpoint Badge ─── */

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span
      className={cn(
        "mr-2 inline-block rounded-md px-2 py-0.5 font-mono text-xs font-bold uppercase",
        method === "POST"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      )}
    >
      {method}
    </span>
  );
}

/* ─── Section Layout ─── */

function Section({
  id,
  number,
  title,
  alt,
  children,
}: {
  id: string;
  number: string;
  title: string;
  alt?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 py-16 lg:py-24",
        alt ? "bg-muted/40" : "bg-background"
      )}
    >
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-muted-foreground mb-2 font-mono text-xs tracking-widest uppercase">
          {number}
        </p>
        <h2 className="font-display mb-8 text-2xl font-semibold tracking-tight lg:text-3xl">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/* ─── Endpoint Block ─── */

function Endpoint({
  method,
  path,
  auth,
  description,
  children,
}: {
  method: "GET" | "POST";
  path: string;
  auth: boolean;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-12 last:mb-0">
      <div className="mb-3 flex items-center gap-2">
        <MethodBadge method={method} />
        <code className="font-mono text-base font-semibold">{path}</code>
      </div>
      <p className="text-muted-foreground mb-1 text-sm">
        {description}
      </p>
      <p className="text-muted-foreground mb-4 text-xs">
        {auth ? (
          <>
            Auth: <code className="text-foreground/70">Authorization: Bearer al_live_...</code>
          </>
        ) : (
          <span className="text-emerald-600 dark:text-emerald-400">No authentication required</span>
        )}
      </p>
      {children}
    </div>
  );
}

/* ─── Table ─── */

function ParamTable({
  rows,
}: {
  rows: { name: string; type: string; required: string; desc: string }[];
}) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-muted/60 text-left">
            <th className="px-4 py-2 font-medium">Field</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Required</th>
            <th className="px-4 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="px-4 py-2 font-mono text-xs">{r.name}</td>
              <td className="text-muted-foreground px-4 py-2 text-xs">{r.type}</td>
              <td className="px-4 py-2 text-xs">{r.required}</td>
              <td className="text-muted-foreground px-4 py-2 text-xs">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResponseBlock({ code }: { code: string }) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border bg-[oklch(0.13_0_0)] shadow-md">
      <div className="border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-white/50">Response</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-white/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ─── Main Docs Page ─── */

export function DocsPage() {
  return (
    <div className="min-h-screen pt-20">
      {/* ─── Header ─── */}
      <header className="bg-background py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5">
          <p className="text-primary mb-4 font-mono text-sm font-medium">
            Developer Documentation
          </p>
          <h1 className="font-display mb-6 text-4xl font-bold tracking-tight lg:text-5xl">
            AgentLair API
          </h1>
          <p className="text-muted-foreground mb-8 max-w-xl text-lg leading-relaxed">
            Portable cryptographic identity and behavioral trust for AI agents.
            Register, issue tokens, and query trust scores — zero to first API
            call in 5 minutes.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-[oklch(0.13_0_0)] px-5 py-3.5 font-mono text-sm text-white/90 shadow">
            <span className="text-white/50">Base URL</span>
            <span>https://agentlair.dev</span>
          </div>
        </div>
      </header>

      {/* ─── Nav ─── */}
      <nav className="sticky top-16 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-5 py-2 text-sm">
          {[
            { href: "#quickstart", label: "Quickstart" },
            { href: "#auth", label: "Auth" },
            { href: "#endpoints", label: "Endpoints" },
            { href: "#trust", label: "Trust" },
            { href: "#discovery", label: "Discovery" },
            { href: "#integrations", label: "Integrations" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 transition-colors hover:bg-muted"
            >
              {l.label}
            </a>
          ))}
        </div>
      </nav>

      {/* ─── 01 Quickstart ─── */}
      <Section id="quickstart" number="01" title="Quickstart">
        <p className="text-muted-foreground mb-6 leading-relaxed">
          Register an agent, issue an AAT, verify it, and check a trust score.
          All you need is <code>curl</code>.
        </p>

        <h3 className="mb-3 text-lg font-semibold">1. Register your agent</h3>
        <CodeTabs
          group="qs-register"
          tabs={[
            {
              lang: "curl",
              label: "curl",
              code: `curl -X POST https://agentlair.dev/v1/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'`,
            },
            {
              lang: "typescript",
              label: "TypeScript",
              code: `const res = await fetch("https://agentlair.dev/v1/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "my-agent" }),
});
const { api_key, account_id } = await res.json();
// Save api_key — it's shown once`,
            },
            {
              lang: "python",
              label: "Python",
              code: `import httpx

res = httpx.post(
    "https://agentlair.dev/v1/register",
    json={"name": "my-agent"},
)
data = res.json()
api_key = data["api_key"]      # Save this — shown once
account_id = data["account_id"]`,
            },
          ]}
        />
        <ResponseBlock
          code={`{
  "api_key": "al_live_k7x9m2p4...",
  "account_id": "acc_7kX9mP2qR4wL",
  "email_address": "my-agent@agentlair.dev",
  "tier": "free",
  "status": "unverified"
}`}
        />

        <h3 className="mb-3 mt-8 text-lg font-semibold">
          2. Issue an AAT
        </h3>
        <p className="text-muted-foreground mb-4 text-sm">
          An <strong>Agent Authentication Token</strong> is a short-lived
          Ed25519-signed JWT your agent presents to services.
        </p>
        <CodeTabs
          group="qs-issue"
          tabs={[
            {
              lang: "curl",
              label: "curl",
              code: `curl -X POST https://agentlair.dev/v1/tokens/issue \\
  -H "Authorization: Bearer al_live_k7x9m2p4..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "audience": "https://your-mcp-server.com",
    "scopes": ["mcp:tools:read"]
  }'`,
            },
            {
              lang: "typescript",
              label: "TypeScript",
              code: `const res = await fetch("https://agentlair.dev/v1/tokens/issue", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.AGENTLAIR_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    audience: "https://your-mcp-server.com",
    scopes: ["mcp:tools:read"],
  }),
});
const { token } = await res.json();
// Pass as: Authorization: Bearer <token>`,
            },
            {
              lang: "python",
              label: "Python",
              code: `import httpx, os

res = httpx.post(
    "https://agentlair.dev/v1/tokens/issue",
    headers={"Authorization": f"Bearer {os.environ['AGENTLAIR_API_KEY']}"},
    json={
        "audience": "https://your-mcp-server.com",
        "scopes": ["mcp:tools:read"],
    },
)
token = res.json()["token"]`,
            },
          ]}
        />

        <h3 className="mb-3 mt-8 text-lg font-semibold">
          3. Verify the AAT (on your server)
        </h3>
        <CodeTabs
          group="qs-verify"
          tabs={[
            {
              lang: "curl",
              label: "curl",
              code: `# Introspect via AgentLair (public, no auth needed)
curl -X POST https://agentlair.dev/v1/tokens/introspect \\
  -H "Content-Type: application/json" \\
  -d '{"token": "eyJhbGciOiJFZERTQSI..."}'

# Or verify locally using JWKS (preferred — no round-trip)
# Fetch once: GET https://agentlair.dev/.well-known/jwks.json`,
            },
            {
              lang: "typescript",
              label: "TypeScript",
              code: `// npm install @agentlair/verify
import { verifyAAT } from "@agentlair/verify";

const result = await verifyAAT(token);

if (result.valid) {
  console.log("Agent ID:", result.agentId);    // "acc_..."
  console.log("Scopes:",   result.scopes);     // ["mcp:tools:read"]
} else {
  console.error("Rejected:", result.error);
}`,
            },
            {
              lang: "python",
              label: "Python",
              code: `import httpx
from joserfc import jwt
from joserfc.jwk import KeySet

def verify_aat(token: str) -> dict | None:
    jwks = httpx.get(
        "https://agentlair.dev/.well-known/jwks.json"
    ).json()
    key_set = KeySet.import_key_set(jwks)

    try:
        result = jwt.decode(token, key_set)
        return result.claims
    except Exception:
        return None`,
            },
          ]}
        />

        <h3 className="mb-3 mt-8 text-lg font-semibold">
          4. Check trust score
        </h3>
        <CodeTabs
          group="qs-trust"
          tabs={[
            {
              lang: "curl",
              label: "curl",
              code: `# Full trust profile
curl https://agentlair.dev/v1/trust/acc_7kX9mP2qR4wL \\
  -H "Authorization: Bearer al_live_k7x9m2p4..."

# Fast gate check (is this agent at least "junior"?)
curl "https://agentlair.dev/v1/trust/acc_7kX9mP2qR4wL/check?min_level=junior" \\
  -H "Authorization: Bearer al_live_k7x9m2p4..."`,
            },
            {
              lang: "typescript",
              label: "TypeScript",
              code: `async function checkTrust(
  agentId: string,
  minScore = 500
): Promise<boolean> {
  const res = await fetch(
    \`https://agentlair.dev/v1/trust/\${agentId}\`,
    {
      headers: {
        Authorization: \`Bearer \${process.env.AGENTLAIR_API_KEY}\`,
      },
    }
  );
  const { score } = await res.json();
  return score >= minScore;
}`,
            },
            {
              lang: "python",
              label: "Python",
              code: `import httpx, os

def check_trust(agent_id: str, min_score: int = 500) -> bool:
    res = httpx.get(
        f"https://agentlair.dev/v1/trust/{agent_id}",
        headers={
            "Authorization": f"Bearer {os.environ['AGENTLAIR_API_KEY']}"
        },
    )
    return res.json()["score"] >= min_score`,
            },
          ]}
        />
      </Section>

      {/* ─── 02 Authentication ─── */}
      <Section id="auth" number="02" title="Authentication" alt>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          AgentLair uses two credential types. Understand when to use each.
        </p>

        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border p-5">
            <h4 className="mb-2 font-semibold">API Key</h4>
            <p className="text-muted-foreground mb-3 text-sm">
              Authenticates your agent to the AgentLair API itself.
            </p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              <li>Format: <code>al_live_...</code></li>
              <li>Lifetime: persistent</li>
              <li>Audience: AgentLair only</li>
              <li>Shown once at registration</li>
            </ul>
          </div>
          <div className="rounded-xl border p-5">
            <h4 className="mb-2 font-semibold">AAT (Agent Auth Token)</h4>
            <p className="text-muted-foreground mb-3 text-sm">
              Authenticates your agent to any external service.
            </p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              <li>Format: Ed25519-signed JWT</li>
              <li>Lifetime: 1h default (max 24h)</li>
              <li>Audience: any service URI you specify</li>
              <li>Verifiable by anyone via JWKS</li>
            </ul>
          </div>
        </div>

        <h3 className="mb-3 text-lg font-semibold">
          AAT JWT Claims
        </h3>
        <div className="overflow-hidden rounded-xl border bg-[oklch(0.13_0_0)] shadow-md">
          <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-white/90">
            <code>{`{
  "iss": "https://agentlair.dev",
  "sub": "acc_7kX9mP2qR4wL",               // Agent account ID
  "aud": "https://your-mcp-server.com",     // Target service
  "exp": 1745003600,                        // Expiry (Unix)
  "iat": 1745000000,                        // Issued at
  "jti": "aat_a1b2c3d4e5f6",               // Unique token ID
  "did": "did:web:agentlair.dev:agents:acc_7kX9mP2qR4wL",
  "al_scopes": ["mcp:tools:read"],          // Permissions
  "al_audit_url": "https://agentlair.dev/v1/audit/aat_...",
  "al_name": "my-agent",                    // Display name
  "al_email": "my-agent@agentlair.dev"      // Agent email
}`}</code>
          </pre>
        </div>

        <h3 className="mb-3 mt-8 text-lg font-semibold">
          Passing Credentials
        </h3>
        <p className="text-muted-foreground mb-3 text-sm">
          All authenticated endpoints accept the API key as a Bearer token:
        </p>
        <div className="overflow-hidden rounded-xl border bg-[oklch(0.13_0_0)] shadow-md">
          <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-white/90">
            <code>{`Authorization: Bearer al_live_k7x9m2p4...`}</code>
          </pre>
        </div>
      </Section>

      {/* ─── 03 Endpoints ─── */}
      <Section id="endpoints" number="03" title="API Endpoints">
        <p className="text-muted-foreground mb-10 leading-relaxed">
          Six core endpoints. All accept and return JSON.
        </p>

        {/* POST /v1/register */}
        <Endpoint
          method="POST"
          path="/v1/register"
          auth={false}
          description="Create a new agent account. Returns an API key (shown once)."
        >
          <ParamTable
            rows={[
              { name: "name", type: "string", required: "name or address", desc: "Agent name — email derived from this" },
              { name: "address", type: "string", required: "name or address", desc: "Explicit @agentlair.dev address" },
              { name: "recovery_email", type: "string", required: "No", desc: "Operator email for dashboard access" },
              { name: "public_key", type: "string", required: "No", desc: "Base64url X25519 key for E2E encryption" },
              { name: "capabilities", type: "string[]", required: "No", desc: "Declared capabilities (max 10)" },
            ]}
          />
          <ResponseBlock
            code={`// 201 Created
{
  "api_key": "al_live_k7x9m2p4...",
  "account_id": "acc_7kX9mP2qR4wL",
  "email_address": "my-agent@agentlair.dev",
  "tier": "free",
  "status": "unverified",
  "limits": { "emails_per_day": 10, "requests_per_day": 100 },
  "warning": "Save your API key — it will not be shown again."
}`}
          />
          <p className="text-muted-foreground text-xs">
            Rate limit: 5 registrations per IP per hour. If{" "}
            <code>recovery_email</code> is provided, account enters restricted
            mode until OTP verification via{" "}
            <code>POST /v1/register/verify</code>.
          </p>
        </Endpoint>

        {/* POST /v1/tokens/issue */}
        <Endpoint
          method="POST"
          path="/v1/tokens/issue"
          auth={true}
          description="Issue a signed AAT (Agent Authentication Token) for a target service."
        >
          <ParamTable
            rows={[
              { name: "audience", type: "string", required: "Yes", desc: "Target service URI" },
              { name: "scopes", type: "string[]", required: "Yes", desc: "Permission scopes (non-empty)" },
              { name: "ttl", type: "number", required: "No", desc: "Token lifetime in seconds (60–86400, default 3600)" },
              { name: "agent_name", type: "string", required: "No", desc: "Override display name in token claims" },
              { name: "agent_email", type: "string", required: "No", desc: "Agent email in token claims" },
            ]}
          />
          <ResponseBlock
            code={`// 201 Created
{
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_at": "2026-04-19T11:00:00Z",
  "expires_in": 3600,
  "jti": "aat_a1b2c3d4e5f6",
  "audit_url": "https://agentlair.dev/v1/audit/aat_a1b2c3d4e5f6"
}`}
          />
        </Endpoint>

        {/* POST /v1/tokens/introspect */}
        <Endpoint
          method="POST"
          path="/v1/tokens/introspect"
          auth={false}
          description="Validate an AAT and return its claims. Implements RFC 7662."
        >
          <ParamTable
            rows={[
              { name: "token", type: "string", required: "Yes", desc: "JWT token to validate" },
            ]}
          />
          <ResponseBlock
            code={`// 200 OK — active token
{
  "active": true,
  "sub": "acc_7kX9mP2qR4wL",
  "iss": "https://agentlair.dev",
  "aud": "https://your-mcp-server.com",
  "exp": 1745003600,
  "scope": "mcp:tools:read",
  "al_scopes": ["mcp:tools:read"],
  "did": "did:web:agentlair.dev:agents:acc_7kX9mP2qR4wL"
}

// 200 OK — expired or invalid
{ "active": false }`}
          />
          <p className="text-muted-foreground text-xs">
            Per RFC 7662, introspection always returns 200 — check the{" "}
            <code>active</code> field. For high-throughput use cases, prefer
            local JWKS verification instead.
          </p>
        </Endpoint>

        {/* GET /v1/trust/:id */}
        <Endpoint
          method="GET"
          path="/v1/trust/:agentId"
          auth={true}
          description="Return the full behavioral trust profile for an agent."
        >
          <ParamTable
            rows={[
              { name: "agentId", type: "string", required: "Path", desc: "Agent account ID (acc_...)" },
            ]}
          />
          <ResponseBlock
            code={`// 200 OK
{
  "agent_id": "acc_7kX9mP2qR4wL",
  "score": 725,
  "confidence": 0.82,
  "atf_level": "senior",
  "dimensions": {
    "consistency": { "score": 850, "signals": ["token_usage_patterns_stable"] },
    "restraint": { "score": 720, "signals": ["respects_rate_limits"] },
    "transparency": { "score": 605, "signals": ["audit_trail_complete"] }
  },
  "trend": "improving"
}`}
          />
        </Endpoint>

        {/* GET /v1/trust/:id/check */}
        <Endpoint
          method="GET"
          path="/v1/trust/:agentId/check"
          auth={true}
          description="Fast-path trust gate. Returns a boolean pass/fail against a minimum ATF level."
        >
          <ParamTable
            rows={[
              { name: "agentId", type: "string", required: "Path", desc: "Agent account ID (acc_...)" },
              { name: "min_level", type: "string", required: "Query", desc: "Minimum ATF level: intern | junior | senior | principal" },
            ]}
          />
          <ResponseBlock
            code={`// 200 OK
{
  "agent_id": "acc_7kX9mP2qR4wL",
  "score": 725,
  "atf_level": "senior",
  "meets_minimum": true,
  "required_level": "junior",
  "confidence": 0.82
}`}
          />
        </Endpoint>

        {/* POST /v1/telemetry/submit */}
        <Endpoint
          method="POST"
          path="/v1/telemetry/submit"
          auth={true}
          description="Submit behavioral observations to build cross-organizational trust."
        >
          <ParamTable
            rows={[
              { name: "event", type: "string", required: "Yes", desc: "Event type identifier" },
              { name: "agent_id", type: "string", required: "Yes", desc: "Agent account ID being observed" },
              { name: "timestamp", type: "string", required: "Yes", desc: "ISO 8601 timestamp" },
              { name: "action_type", type: "string", required: "Yes", desc: "tool_call | memory_update | decision | external_request" },
              { name: "outcome", type: "string", required: "Yes", desc: "success | failure | anomaly" },
              { name: "axiom_hash", type: "string", required: "No", desc: "SHA-256 hash of observation content" },
              { name: "context_ref", type: "string", required: "No", desc: "Correlation ID for grouping events" },
            ]}
          />
          <ResponseBlock
            code={`// 201 Created — single event
{ "status": "accepted", "observation_id": "obs_..." }

// Batch: pass an array of events
[
  { "event": "axiom.committed", "agent_id": "acc_...", ... },
  { "event": "axiom.committed", "agent_id": "acc_...", ... }
]`}
          />
        </Endpoint>

        {/* ─── Summary table ─── */}
        <h3 className="mb-4 mt-12 text-lg font-semibold">Endpoint Summary</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-left">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 font-medium">Auth</th>
                <th className="px-4 py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["/v1/register", "POST", "No", "Create agent account"],
                ["/v1/tokens/issue", "POST", "Yes", "Issue AAT"],
                ["/v1/tokens/introspect", "POST", "No", "Verify AAT (RFC 7662)"],
                ["/v1/tokens/info", "GET", "Yes", "Token service metadata"],
                ["/v1/trust/:agentId", "GET", "Yes", "Full trust profile"],
                ["/v1/trust/:agentId/check", "GET", "Yes", "Fast trust gate check"],
                ["/v1/telemetry/submit", "POST", "Yes", "Submit observations"],
                ["/.well-known/jwks.json", "GET", "No", "Ed25519 signing key"],
                ["/.well-known/openid-configuration", "GET", "No", "OIDC discovery"],
              ].map(([ep, method, auth, purpose]) => (
                <tr key={ep} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{ep}</td>
                  <td className="px-4 py-2">
                    <MethodBadge method={method as "GET" | "POST"} />
                  </td>
                  <td className="px-4 py-2 text-xs">{auth}</td>
                  <td className="px-4 py-2 text-xs">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── 04 Trust Scoring ─── */}
      <Section id="trust" number="04" title="Trust Scoring" alt>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          L4 behavioral trust is what makes AgentLair different from every other
          identity layer. Trust scores reflect <em>how an agent behaves</em>,
          not just whether it can authenticate.
        </p>

        <h3 className="mb-3 text-lg font-semibold">
          Three Dimensions
        </h3>
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              name: "Consistency",
              desc: "Stable usage patterns, regular interaction history, recency of activity.",
            },
            {
              name: "Restraint",
              desc: "Respects rate limits, stays within declared scopes, no anomalous bursts.",
            },
            {
              name: "Transparency",
              desc: "Complete audit trails, shared observations, high ratio of visible actions.",
            },
          ].map((d) => (
            <div key={d.name} className="rounded-xl border p-5">
              <h4 className="mb-2 font-semibold">{d.name}</h4>
              <p className="text-muted-foreground text-sm">{d.desc}</p>
            </div>
          ))}
        </div>

        <h3 className="mb-3 text-lg font-semibold">ATF Levels</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          Agent Trust Framework levels map score ranges to semantic trust tiers.
          Use <code>/v1/trust/:id/check?min_level=...</code> for gate decisions.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-left">
                <th className="px-4 py-2 font-medium">Level</th>
                <th className="px-4 py-2 font-medium">Score Range</th>
                <th className="px-4 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-t">
                <td className="px-4 py-2 font-mono text-xs">intern</td>
                <td className="px-4 py-2">0–249</td>
                <td className="px-4 py-2 text-xs">New agent — no behavioral history</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2 font-mono text-xs">junior</td>
                <td className="px-4 py-2">250–499</td>
                <td className="px-4 py-2 text-xs">Some signal, limited cross-org coverage</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2 font-mono text-xs">senior</td>
                <td className="px-4 py-2">500–749</td>
                <td className="px-4 py-2 text-xs">Established, consistent behavioral baseline</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2 font-mono text-xs">principal</td>
                <td className="px-4 py-2">750–1000</td>
                <td className="px-4 py-2 text-xs">Deep history, high transparency across organizations</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="mb-3 mt-8 text-lg font-semibold">
          Cold Start
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          New agents start at <code>intern</code> level with score 0.
          Trust builds naturally as the agent interacts with AgentLair-integrated
          services and submits telemetry. Unlike org-local trust systems, trust
          earned in one organization carries to every subsequent integration.
          Scores are computed on query, not stored — they reflect current
          behavioral data. Trust decays naturally when an agent stops operating.
        </p>
      </Section>

      {/* ─── 05 Discovery ─── */}
      <Section id="discovery" number="05" title="Discovery & JWKS">
        <p className="text-muted-foreground mb-6 leading-relaxed">
          Standard discovery endpoints for offline token verification.
          No authentication required.
        </p>

        <Endpoint
          method="GET"
          path="/.well-known/jwks.json"
          auth={false}
          description="Platform Ed25519 public key for verifying all AATs."
        >
          <ResponseBlock
            code={`{
  "keys": [{
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url-encoded-public-key>",
    "kid": "<key-id>",
    "use": "sig",
    "alg": "EdDSA"
  }]
}`}
          />
          <p className="text-muted-foreground text-xs">
            Cache this response. Refresh when you receive a <code>kid</code>{" "}
            mismatch — the key rotates infrequently.
          </p>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/.well-known/openid-configuration"
          auth={false}
          description="OIDC Discovery document with standard metadata."
        >
          <p className="text-muted-foreground text-sm">
            Returns <code>token_endpoint</code>,{" "}
            <code>introspection_endpoint</code>, and{" "}
            <code>id_token_signing_alg_values_supported: ["EdDSA"]</code>.
          </p>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/agents/:name/.well-known/jwks.json"
          auth={false}
          description="Per-agent DID Web JWKS endpoint."
        >
          <p className="text-muted-foreground text-sm">
            Resolves to the DID Web identifier:{" "}
            <code>did:web:agentlair.dev:agents:{"<name>"}</code>
          </p>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/v1/tokens/info"
          auth={true}
          description="Token service metadata — issuer, JWKS URI, TTL limits."
        >
          <ResponseBlock
            code={`{
  "issuer": "https://agentlair.dev",
  "jwks_uri": "https://agentlair.dev/.well-known/jwks.json",
  "signing_algorithm": "EdDSA",
  "supported_scopes": "any (agent-declared, validated by target service)",
  "default_ttl": 3600,
  "max_ttl": 86400,
  "min_ttl": 60
}`}
          />
        </Endpoint>
      </Section>

      {/* ─── 06 Integrations ─── */}
      <Section id="integrations" number="06" title="Integrations" alt>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          Real-world projects that have integrated AgentLair's L4 primitives.
        </p>

        <div className="space-y-6">
          <div className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-3">
              <h4 className="font-semibold">Springdrift</h4>
              <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                Gleam
              </span>
            </div>
            <p className="text-muted-foreground mb-2 text-sm">
              Functional agent runtime with axiom-based behavioral tracking.
              Telemetry from Springdrift&apos;s axiom engine flows to{" "}
              <code>/v1/telemetry/submit</code>.
            </p>
            <a
              href="https://github.com/seamus-brady/springdrift"
              className="text-primary text-sm hover:underline"
              target="_blank"
              rel="noopener"
            >
              github.com/seamus-brady/springdrift
            </a>
          </div>

          <div className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-3">
              <h4 className="font-semibold">task-orchestrator</h4>
              <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                TypeScript
              </span>
            </div>
            <p className="text-muted-foreground mb-2 text-sm">
              Production task queue with JWKS-based <code>ActorVerifier</code>.
              First external adoption of the verification protocol.
            </p>
            <a
              href="https://github.com/jpicklyk/task-orchestrator"
              className="text-primary text-sm hover:underline"
              target="_blank"
              rel="noopener"
            >
              github.com/jpicklyk/task-orchestrator
            </a>
          </div>

          <div className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-3">
              <h4 className="font-semibold">DashClaw</h4>
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Python
              </span>
            </div>
            <p className="text-muted-foreground mb-2 text-sm">
              Multi-agent orchestrator with JWKS-based actor verification.
              Validates AATs before granting access to shared resources.
            </p>
            <a
              href="https://github.com/ucsandman/DashClaw"
              className="text-primary text-sm hover:underline"
              target="_blank"
              rel="noopener"
            >
              github.com/ucsandman/DashClaw
            </a>
          </div>

          <div className="rounded-xl border p-5">
            <div className="mb-2 flex items-center gap-3">
              <h4 className="font-semibold">Mastra</h4>
              <span className="rounded-md bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                TypeScript
              </span>
            </div>
            <p className="text-muted-foreground mb-2 text-sm">
              Open-source AI agent framework with AgentLair identity integration.
            </p>
            <a
              href="https://github.com/mastra-ai/mastra"
              className="text-primary text-sm hover:underline"
              target="_blank"
              rel="noopener"
            >
              github.com/mastra-ai/mastra
            </a>
          </div>
        </div>
      </Section>

      {/* ─── Error Reference ─── */}
      <Section id="errors" number="07" title="Error Reference">
        <p className="text-muted-foreground mb-6 leading-relaxed">
          All errors return a JSON body with <code>error</code> and{" "}
          <code>message</code> fields.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-left">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Meaning</th>
                <th className="px-4 py-2 font-medium">Common Causes</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["400", "Bad Request", "Invalid JSON, missing required fields, invalid format"],
                ["401", "Unauthorized", "Missing or invalid API key"],
                ["402", "Payment Required", "Rate limit exceeded — pay via x402 to continue"],
                ["403", "Forbidden", "Requested scopes exceed account ceiling"],
                ["404", "Not Found", "Agent ID not found"],
                ["409", "Conflict", "Address already claimed, account already verified"],
                ["429", "Rate Limited", "Too many requests (registration: 5/IP/hour)"],
                ["503", "Service Unavailable", "Signing key or trust database not configured"],
              ].map(([code, meaning, causes]) => (
                <tr key={code} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs font-semibold">{code}</td>
                  <td className="px-4 py-2 text-xs">{meaning}</td>
                  <td className="px-4 py-2 text-xs">{causes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ResponseBlock
          code={`// Example error response
{
  "error": "invalid_scopes",
  "message": "Scopes array must be non-empty"
}`}
        />
      </Section>

      {/* ─── Footer CTA ─── */}
      <section className="bg-muted/40 py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="font-display mb-4 text-2xl font-semibold">
            Ready to integrate?
          </h2>
          <p className="text-muted-foreground mx-auto mb-8 max-w-md">
            Register your first agent and start building trust in under 5
            minutes. Free tier includes 100 API calls/day.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="/register"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 font-medium shadow transition-colors"
            >
              Register an Agent
            </a>
            <a
              href="mailto:hei@agentlair.dev"
              className="text-foreground hover:bg-muted rounded-lg border px-6 py-3 font-medium transition-colors"
            >
              Contact Support
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
