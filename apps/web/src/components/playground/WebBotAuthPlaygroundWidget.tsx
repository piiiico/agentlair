import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Inline signRequest helper (Web Crypto only — no SDK import) ──────────────

async function signRequestInline(opts: {
  url: string;
  privateKey: CryptoKey;
  thumbprint: string;
  expiresIn?: number;
  label?: string;
}): Promise<{ headers: Record<string, string>; signatureBase: string }> {
  const { url, privateKey, thumbprint, expiresIn = 300, label = 'sig1' } = opts;
  const created = Math.floor(Date.now() / 1000);
  const expires = created + expiresIn;
  const sigParams = `("@authority" "@target-uri");created=${created};expires=${expires};keyid="${thumbprint}";tag="web-bot-auth"`;
  const parsedUrl = new URL(url);
  const signatureBase = [
    `"@authority": ${parsedUrl.host}`,
    `"@target-uri": ${url}`,
    `"@signature-params": ${sigParams}`,
  ].join('\n');
  const sigBytes = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(signatureBase),
  );
  // Standard base64 per RFC 8941 byte sequence encoding
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return {
    headers: {
      'Signature-Input': `${label}=${sigParams}`,
      'Signature': `${label}=:${sigB64}:`,
      'Signature-Agent': `https://agentlair.dev/agents/${thumbprint}`,
    },
    signatureBase,
  };
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeyState {
  privateKey: CryptoKey;
  publicKeyB64url: string;
  thumbprint: string;
  apiKey: string;
}

interface L3Result {
  valid: boolean;
  key_id: string | null;
  thumbprint: string | null;
  covered_components: string[];
  created: number | null;
  expires: number | null;
  alg: string;
  failure_reason?: string;
  signature_base?: string;
  signing_agent_url?: string | null;
}

interface L4Agent {
  did: string;
  handle: string | null;
  account_id: string;
  popa_streak: number | null;
  bcc_count: number | null;
  signing_keys_count: number;
  first_seen: string;
}

interface L4Result {
  agent: L4Agent | null;
  resolution_path: string;
}

interface VerifyResult {
  l3: L3Result;
  l4: L4Result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WebBotAuthPlaygroundWidget() {
  const [activeTab, setActiveTab] = useState<string>('sign');

  // Sign tab state
  const [signUrl, setSignUrl] = useState('https://example.com/api');
  const [signMethod, setSignMethod] = useState('GET');
  const [keyState, setKeyState] = useState<KeyState | null>(null);
  const [signHeaders, setSignHeaders] = useState<Record<string, string> | null>(null);
  const [signatureBase, setSignatureBase] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [signLoading, setSignLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Verify tab state
  const [verifyUrl, setVerifyUrl] = useState('https://example.com/api');
  const [verifyMethod, setVerifyMethod] = useState('GET');
  const [verifyHeadersText, setVerifyHeadersText] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const handleSign = useCallback(async () => {
    setSignError(null);
    setSignLoading(true);
    setSignHeaders(null);
    setSignatureBase(null);

    try {
      // 1. Generate Ed25519 keypair in browser
      const pair = await crypto.subtle.generateKey(
        { name: 'Ed25519' },
        true,
        ['sign', 'verify'],
      );
      const publicKeyRaw = new Uint8Array(
        await crypto.subtle.exportKey('raw', pair.publicKey),
      );
      const publicKeyB64url = b64url(publicKeyRaw);

      // 2. Register anonymously to get an API key
      const suffix = Math.random().toString(36).slice(2, 8);
      const regRes = await fetch('/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `wba-playground-${suffix}` }),
      });
      if (!regRes.ok) {
        const text = await regRes.text();
        throw new Error(`Registration failed (${regRes.status}): ${text.slice(0, 200)}`);
      }
      const regData = await regRes.json() as { api_key: string };
      const apiKey = regData.api_key;

      // 3. Register signing key
      const keyRes = await fetch('/v1/agents/signing-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ public_key: publicKeyB64url }),
      });
      if (!keyRes.ok) {
        const text = await keyRes.text();
        throw new Error(`Key registration failed (${keyRes.status}): ${text.slice(0, 200)}`);
      }
      const keyData = await keyRes.json() as { thumbprint: string };
      const thumbprint = keyData.thumbprint;

      // 4. Sign the request
      const { headers, signatureBase: base } = await signRequestInline({
        url: signUrl,
        privateKey: pair.privateKey,
        thumbprint,
      });

      setKeyState({ privateKey: pair.privateKey, publicKeyB64url, thumbprint, apiKey });
      setSignHeaders(headers);
      setSignatureBase(base);

      // Auto-fill verify tab
      const headersText = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      setVerifyHeadersText(headersText);
      setVerifyUrl(signUrl);
      setVerifyMethod(signMethod);
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setSignLoading(false);
    }
  }, [signUrl, signMethod]);

  const buildCurl = useCallback(() => {
    if (!signHeaders) return '';
    const parts = [`curl -X ${signMethod} '${signUrl}'`];
    for (const [k, v] of Object.entries(signHeaders)) {
      parts.push(`  -H '${k}: ${v}'`);
    }
    return parts.join(' \\\n');
  }, [signHeaders, signMethod, signUrl]);

  const handleCopyCurl = useCallback(async () => {
    await navigator.clipboard.writeText(buildCurl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [buildCurl]);

  const handleVerify = useCallback(async () => {
    setVerifyError(null);
    setVerifyResult(null);
    setVerifyLoading(true);

    try {
      // Parse headers textarea
      const headers: Record<string, string> = {};
      for (const line of verifyHeadersText.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const k = line.slice(0, colon).trim().toLowerCase();
        const v = line.slice(colon + 1).trim();
        if (k && v) headers[k] = v;
      }

      if (!headers['signature-input'] || !headers['signature']) {
        throw new Error('Headers must include Signature-Input and Signature');
      }

      const res = await fetch('/v1/wba/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: verifyMethod,
          url: verifyUrl,
          headers,
        }),
      });

      const data = await res.json() as VerifyResult;
      setVerifyResult(data);
    } catch (e) {
      setVerifyError((e as Error).message);
    } finally {
      setVerifyLoading(false);
    }
  }, [verifyHeadersText, verifyUrl, verifyMethod]);

  return (
    <div className="rounded-xl border bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full rounded-t-xl rounded-b-none border-b bg-muted/30 p-0">
          <TabsTrigger
            value="sign"
            className="flex-1 rounded-none rounded-tl-xl py-3 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-background"
          >
            1. Sign
          </TabsTrigger>
          <TabsTrigger
            value="verify"
            className="flex-1 rounded-none rounded-tr-xl py-3 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-background"
          >
            2. Verify
          </TabsTrigger>
        </TabsList>

        {/* ─── Sign tab ─── */}
        <TabsContent value="sign" className="p-6">
          <p className="text-muted-foreground mb-5 text-sm">
            Generates an ephemeral Ed25519 keypair, registers it anonymously,
            and signs an HTTP request per RFC 9421. The signed headers are
            auto-filled into the Verify tab.
          </p>

          <div className="mb-4 grid gap-3 sm:grid-cols-[auto_1fr]">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Method</label>
              <select
                value={signMethod}
                onChange={e => setSignMethod(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">URL</label>
              <Input
                value={signUrl}
                onChange={e => setSignUrl(e.target.value)}
                placeholder="https://example.com/api"
                className="h-9 font-mono text-sm"
              />
            </div>
          </div>

          <Button
            onClick={handleSign}
            disabled={signLoading}
            className="mb-5 w-full sm:w-auto"
          >
            {signLoading ? 'Generating keypair and signing...' : 'Generate keypair + sign'}
          </Button>

          {signError && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {signError}
            </div>
          )}

          {signHeaders && (
            <div className="space-y-4">
              {([
                ['Signature-Input', 'Lists which headers and parameters are covered by this signature.'],
                ['Signature', 'The Ed25519 signature bytes, base64-encoded per RFC 8941.'],
                ['Signature-Agent', 'URL where verifiers fetch the public key (your agent directory entry).'],
              ] as [string, string][]).map(([header, tooltip]) => (
                <div key={header}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{header}</span>
                    <details className="inline">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">what is this?</summary>
                      <p className="mt-1 text-xs text-muted-foreground">{tooltip}</p>
                    </details>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {signHeaders[header]}
                  </pre>
                </div>
              ))}

              {signatureBase && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Show signature base (what was signed)
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {signatureBase}
                  </pre>
                </details>
              )}

              {keyState && (
                <p className="text-xs text-muted-foreground">
                  Key thumbprint: <code className="font-mono">{keyState.thumbprint}</code>
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyCurl}
              >
                {copied ? 'Copied!' : 'Copy as cURL'}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Verify tab ─── */}
        <TabsContent value="verify" className="p-6">
          <p className="text-muted-foreground mb-5 text-sm">
            Submit signed headers to <code className="font-mono text-xs">/v1/wba/verify</code>.
            Returns an L3 cryptographic verdict (did the signature check out?) and an L4
            behavioral attestation chain (is this agent registered with AgentLair?).
          </p>

          <div className="mb-4 grid gap-3 sm:grid-cols-[auto_1fr]">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Method</label>
              <select
                value={verifyMethod}
                onChange={e => setVerifyMethod(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">URL</label>
              <Input
                value={verifyUrl}
                onChange={e => setVerifyUrl(e.target.value)}
                placeholder="https://example.com/api"
                className="h-9 font-mono text-sm"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Headers (one per line, colon-separated)
            </label>
            <textarea
              value={verifyHeadersText}
              onChange={e => setVerifyHeadersText(e.target.value)}
              placeholder={`Signature-Input: sig1=("@authority" "@target-uri");...\nSignature: sig1=:...\nSignature-Agent: https://agentlair.dev/agents/...`}
              rows={5}
              className="w-full rounded-md border bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <Button
            onClick={handleVerify}
            disabled={verifyLoading}
            className="mb-5 w-full sm:w-auto"
          >
            {verifyLoading ? 'Verifying...' : 'Verify via /v1/wba/verify'}
          </Button>

          {verifyError && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {verifyError}
            </div>
          )}

          {verifyResult && (
            <div className="space-y-4">
              {/* L3 panel */}
              <div className={`rounded-lg border p-4 ${verifyResult.l3.valid ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20' : 'border-destructive/30 bg-destructive/5'}`}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-lg">{verifyResult.l3.valid ? '✅' : '❌'}</span>
                  <span className="font-semibold">
                    L3 — {verifyResult.l3.valid ? 'Valid signature' : 'Invalid signature'}
                  </span>
                </div>

                {verifyResult.l3.failure_reason && (
                  <p className="mb-3 text-sm text-destructive">{verifyResult.l3.failure_reason}</p>
                )}

                <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                  <dt className="text-muted-foreground">Algorithm</dt>
                  <dd className="font-mono">{verifyResult.l3.alg}</dd>
                  {verifyResult.l3.thumbprint && (
                    <>
                      <dt className="text-muted-foreground">Thumbprint</dt>
                      <dd className="font-mono text-xs break-all">{verifyResult.l3.thumbprint}</dd>
                    </>
                  )}
                  {verifyResult.l3.covered_components?.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Covered</dt>
                      <dd className="font-mono text-xs">{verifyResult.l3.covered_components.join(', ')}</dd>
                    </>
                  )}
                  {verifyResult.l3.created && (
                    <>
                      <dt className="text-muted-foreground">Created</dt>
                      <dd>{new Date(verifyResult.l3.created * 1000).toUTCString()}</dd>
                    </>
                  )}
                  {verifyResult.l3.expires && (
                    <>
                      <dt className="text-muted-foreground">Expires</dt>
                      <dd>{new Date(verifyResult.l3.expires * 1000).toUTCString()}</dd>
                    </>
                  )}
                </dl>

                {verifyResult.l3.signature_base && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Show signature base
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded border bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all">
                      {verifyResult.l3.signature_base}
                    </pre>
                  </details>
                )}
              </div>

              {/* L4 panel */}
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-lg">🔗</span>
                  <span className="font-semibold">L4 — Behavioral attestation</span>
                </div>

                {verifyResult.l4.agent ? (
                  <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                    {verifyResult.l4.agent.handle && (
                      <>
                        <dt className="text-muted-foreground">Handle</dt>
                        <dd className="font-mono">{verifyResult.l4.agent.handle}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">DID</dt>
                    <dd className="font-mono text-xs break-all">{verifyResult.l4.agent.did}</dd>
                    <dt className="text-muted-foreground">Account</dt>
                    <dd className="font-mono text-xs">{verifyResult.l4.agent.account_id.slice(0, 12)}…</dd>
                    <dt className="text-muted-foreground">PoPA streak</dt>
                    <dd>
                      {verifyResult.l4.agent.popa_streak != null ? (
                        <a href={`/popa/${encodeURIComponent(verifyResult.l4.agent.did)}`} className="underline">
                          {verifyResult.l4.agent.popa_streak} days
                        </a>
                      ) : 'No data'}
                    </dd>
                    <dt className="text-muted-foreground">BCC count</dt>
                    <dd>{verifyResult.l4.agent.bcc_count ?? 'No data'}</dd>
                    <dt className="text-muted-foreground">First seen</dt>
                    <dd>{new Date(verifyResult.l4.agent.first_seen).toLocaleDateString()}</dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Signing agent is not registered with AgentLair — L3 verification is
                    RFC-compliant but no behavioral attestation is available.
                    {verifyResult.l4.resolution_path === 'external' && (
                      <> The key resolved from an external URL.</>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
