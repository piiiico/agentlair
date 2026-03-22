// AgentLair Email Inbound Worker
// CF Email Routing catch-all handler
// Receives emails for *@agentlair.dev, stores in KV, fires webhooks
// KV namespace: EMAILS (agentlair-emails)

export default {
  async email(message, env, ctx) {
    const to = message.to;
    // Prefer RFC 2822 From: header (actual sender) over envelope sender
    // (which can be SES bounce addresses like 0100019...@amazonses.com)
    const from = message.headers.get('from') || message.from;
    const subject = message.headers.get('subject') || '(no subject)';
    const msgId = message.headers.get('message-id') || `msg-${Date.now()}`;
    const dateHeader = message.headers.get('date') || new Date().toUTCString();
    const receivedAt = new Date().toISOString();

    // Parse body (text first, fall back to raw)
    let bodyText = '';
    let bodyHtml = '';
    try {
      // CF Email Routing provides a ReadableStream on message.raw
      // We need to consume it as PostalMime or parse headers manually
      // For the spike: read raw email bytes
      const rawEmail = await streamToString(message.raw);
      const parsed = parseEmailParts(rawEmail);
      bodyText = parsed.text;
      bodyHtml = parsed.html;
    } catch (e) {
      bodyText = `[Failed to parse body: ${e.message}]`;
    }

    // Build message object
    const msgObj = {
      message_id: msgId,
      from,
      to,
      subject,
      body: bodyText,
      html: bodyHtml || null,
      received_at: receivedAt,
      date_header: dateHeader,
      read: false,
    };

    // E2E encryption: if a public key is registered for this address, encrypt body before storage
    const pubKeyB64 = await env.EMAILS.get(`email-pubkey:${to}`);
    if (pubKeyB64) {
      try {
        if (msgObj.body) msgObj.body = await eciesEncrypt(pubKeyB64, msgObj.body);
        if (msgObj.html) msgObj.html = await eciesEncrypt(pubKeyB64, msgObj.html);
        msgObj.encrypted = true;
        console.log(`[AgentLair Email] E2E encrypted message for ${to}`);
      } catch (e) {
        console.log(`[AgentLair Email] E2E encryption failed for ${to}: ${e.message}. Storing plaintext.`);
      }
    }

    // Store in KV: key = inbox:{address}:{timestamp}:{safe_msgid}
    const ts = Date.now();
    const safeMsgId = msgId.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 40);
    const msgKey = `inbox:${to}:${String(ts).padStart(16, '0')}:${safeMsgId}`;

    // TTL: 30 days
    await env.EMAILS.put(msgKey, JSON.stringify(msgObj), {
      expirationTtl: 30 * 24 * 3600,
    });

    // Update inbox index (list of recent message keys for fast inbox listing)
    const indexKey = `index:${to}`;
    let index = [];
    try {
      const existing = await env.EMAILS.get(indexKey);
      if (existing) index = JSON.parse(existing);
    } catch (e) {}

    // Prepend new key, keep last 100
    index.unshift(msgKey);
    if (index.length > 100) index = index.slice(0, 100);
    await env.EMAILS.put(indexKey, JSON.stringify(index), {
      expirationTtl: 30 * 24 * 3600,
    });

    console.log(`[AgentLair Email] Stored: ${from} -> ${to} | "${subject}" | key=${msgKey}`);

    // Fire registered webhooks (non-blocking — doesn't delay email storage)
    ctx.waitUntil(deliverWebhooks(env, to, msgObj));
  },
};

// ─── Webhook Delivery ─────────────────────────────────────────────────────────

async function deliverWebhooks(env, address, msgObj) {
  if (!env.EMAILS) return;

  // Look up webhook IDs registered for this address
  const addrIndexKey = `webhook-addr:${address}`;
  const addrIndexRaw = await env.EMAILS.get(addrIndexKey);
  if (!addrIndexRaw) return;

  let webhookIds;
  try { webhookIds = JSON.parse(addrIndexRaw); } catch { return; }
  if (!webhookIds || webhookIds.length === 0) return;

  // Build the event payload
  const payload = {
    event: 'email.received',
    timestamp: new Date().toISOString(),
    data: {
      message_id: msgObj.message_id,
      from: msgObj.from,
      to: msgObj.to,
      subject: msgObj.subject,
      snippet: (msgObj.body || '').slice(0, 120).replace(/\n/g, ' '),
      received_at: msgObj.received_at,
    },
  };
  const payloadStr = JSON.stringify(payload);

  // Deliver to each webhook in parallel (best-effort, 10s timeout each)
  await Promise.allSettled(webhookIds.map(async (id) => {
    const hookRaw = await env.EMAILS.get(`webhook:${id}`);
    if (!hookRaw) return;

    let hook;
    try { hook = JSON.parse(hookRaw); } catch { return; }

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'AgentLair-Webhooks/1.0',
      'X-AgentLair-Event': 'email.received',
      'X-AgentLair-Delivery': crypto.randomUUID(),
    };

    // HMAC-SHA256 signature if a secret is configured
    if (hook.secret) {
      try {
        const sig = await hmacSha256(hook.secret, payloadStr);
        headers['X-AgentLair-Signature'] = `sha256=${sig}`;
      } catch {}
    }

    // Best-effort delivery with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(hook.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: controller.signal,
      });
      console.log(`[AgentLair Webhook] Delivered ${id} → ${hook.url} | status=${resp.status}`);
    } catch (e) {
      console.log(`[AgentLair Webhook] Delivery failed ${id} → ${hook.url}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }));
}

// HMAC-SHA256 using Web Crypto API (available in CF Workers)
async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function streamToString(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  // Concat all Uint8Array chunks
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(combined);
}

function parseEmailParts(raw) {
  // Simple RFC 2822 email parser for text/plain and text/html parts
  // Handles multipart/alternative and simple single-part emails
  const lines = raw.split('\r\n').join('\n').split('\n');

  // Find header/body boundary
  let headerEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') {
      headerEnd = i;
      break;
    }
  }

  const bodyLines = lines.slice(headerEnd + 1);
  const body = bodyLines.join('\n');

  // Check if multipart
  const contentTypeMatch = raw.match(/Content-Type:\s*([^\r\n;]+)/i);
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : 'text/plain';

  if (contentType.startsWith('multipart/')) {
    // Extract boundary
    const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
    if (!boundaryMatch) return { text: body, html: '' };

    const boundary = boundaryMatch[1].trim();
    const parts = raw.split('--' + boundary);

    let textPart = '';
    let htmlPart = '';

    for (const part of parts) {
      if (!part || part.startsWith('--')) continue;
      const partLower = part.toLowerCase();
      if (partLower.includes('content-type: text/plain')) {
        textPart = extractPartBody(part);
      } else if (partLower.includes('content-type: text/html')) {
        htmlPart = extractPartBody(part);
      }
    }

    return { text: textPart, html: htmlPart };
  }

  if (contentType.startsWith('text/html')) {
    return { text: '', html: body };
  }

  // Default: text/plain
  return { text: body, html: '' };
}

function extractPartBody(part) {
  const lines = part.split('\n');
  let headerEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      headerEnd = i;
      break;
    }
  }
  return lines.slice(headerEnd + 1).join('\n').trim();
}

// ─── E2E Encryption (X25519 ECDH + AES-256-GCM) ──────────────────────────────
// Compatible with agentlair-worker/src/crypto.ts:
//   - Same HKDF info string: 'agentlair:aes-256-gcm:v1'
//   - Same serialization: [32 bytes ephPub][12 bytes iv][N bytes ciphertext] → base64url
// Recipient public key: 32-byte raw X25519, base64url encoded.
// Returns: compact base64url blob (client decrypts using deserializeEncrypted + decrypt).

async function eciesEncrypt(recipientPublicKeyB64, plaintext) {
  const pubKeyBytes = b64urlDecode(recipientPublicKeyB64);

  // Import recipient's X25519 public key
  const recipientKey = await crypto.subtle.importKey(
    'raw', pubKeyBytes, { name: 'X25519' }, false, [],
  );

  // Generate ephemeral X25519 key pair
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits'],
  );

  // ECDH: ephemeral private × recipient public → shared secret (32 bytes)
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: recipientKey },
    ephemeralPair.privateKey,
    256,
  );

  // Export ephemeral public key (32 raw bytes)
  const ephemeralPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeralPair.publicKey),
  );

  // HKDF → AES-256-GCM key
  const hkdfKey = await crypto.subtle.importKey(
    'raw', sharedBits, { name: 'HKDF' }, false, ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // zero salt (deterministic, matches crypto.ts)
      info: new TextEncoder().encode('agentlair:aes-256-gcm:v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // AES-256-GCM encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintextBytes),
  );

  // Serialize: [32 bytes ephPub][12 bytes iv][N bytes ciphertext]
  const buf = new Uint8Array(32 + 12 + ciphertext.length);
  buf.set(ephemeralPublicBytes, 0);
  buf.set(iv, 32);
  buf.set(ciphertext, 44);
  return b64urlEncode(buf);
}

function b64urlDecode(str) {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
