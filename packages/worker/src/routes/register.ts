// ─── POST /v1/register — Agent Self-Provisioning ─────────────────────────────
// Canonical agent onboarding endpoint. Zero human intervention required.
// Combines account creation + email claiming into one request.
//
// CRITICAL: isReservedAddress() MUST be called BEFORE any env.EMAILS.get()
// to prevent reserved names (e.g. "admin") from hitting KV lookup first.

import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';
import { encryptEmailField } from '../platform-crypto.js';
import { checkIpRateLimit, getAgentCount, incrementAgentCount, AGENT_LIMITS } from '../middleware/ratelimit.js';
import { validateLocalPart, isReservedAddress } from '../reserved.js';
import { SERVICE_PRICES, make402Response, verifyX402Payment, settleX402Payment, trackX402Spend } from '../x402.js';
import { bumpAgentStats } from './auth.js';

export async function handleRegisterRoute(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { path, method }: RouteContext,
): Promise<Response | null> {
  if (path !== '/v1/register' || method !== 'POST') return null;

  // Rate limit: 20 registrations per IP per hour (generous for devs testing quickstart)
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ipCheck = await checkIpRateLimit(env, clientIp, 'agent-register', 20);
  if (!ipCheck.allowed) {
    return new Response(JSON.stringify({
      error: 'rate_limited',
      message: 'Too many registration requests. Try again later.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '3600',
      },
    });
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch {}

  const address = typeof body.address === 'string' ? body.address : undefined;
  const name = typeof body.name === 'string' ? body.name : undefined;
  const public_key = typeof body.public_key === 'string' ? body.public_key : undefined;
  const recovery_email = typeof body.recovery_email === 'string' ? body.recovery_email : undefined;

  // ── Agent registration limit ───────────────────────────────────────────────────
  // Free tier: max 3 agents per operator email (recovery_email).
  // Anonymous registrations (no recovery_email) are not subject to this limit.
  if (recovery_email) {
    const agentCount = await getAgentCount(env, recovery_email);
    const agentLimit = AGENT_LIMITS.free; // Always check free limit at registration
    if (agentCount >= agentLimit) {
      const paymentHeader = request.headers.get('X-PAYMENT');
      if (!paymentHeader) {
        return make402Response(SERVICE_PRICES.agent_provision, {
          error: 'agent_limit_exceeded',
          message: `Free tier allows ${agentLimit} agents per operator email. Register ${agentCount}/${agentLimit} used. Upgrade at https://agentlair.dev/pricing or pay 0.01 USDC via x402 to register an additional agent.`,
          current_agents: agentCount,
          limit: agentLimit,
          upgrade_url: 'https://agentlair.dev/pricing',
        });
      }
      // x402 payment provided — verify and settle
      const payment = await verifyX402Payment(paymentHeader, SERVICE_PRICES.agent_provision);
      if (!payment.valid) {
        return new Response(JSON.stringify({
          error: 'payment_invalid',
          message: payment.error,
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Payment valid — settle (non-blocking, proceed with registration)
      void settleX402Payment(paymentHeader, SERVICE_PRICES.agent_provision);
      void trackX402Spend(env, recovery_email + ':agent', SERVICE_PRICES.agent_provision.amount, {
        payer: payment.payer,
        service: 'agent_provision',
      });
    }
  }

  // capabilities: optional array of strings, max 10 items
  let capabilities: string[] | undefined;
  if (Array.isArray(body.capabilities)) {
    capabilities = (body.capabilities as unknown[])
      .filter((c): c is string => typeof c === 'string')
      .slice(0, 10);
  }

  // approval_required defaults to false for new accounts.
  // Budget escalation (budget.ts) sets approval_required=true when limits are exceeded.
  // Sandbox mode: first emails work without human intervention — the core product promise.
  const agentApprovalRequired = false;

  let emailAddress = '';

  if (address) {
    // ── Explicit address path ──────────────────────────────────────────────────
    if (!address.endsWith('@agentlair.dev')) {
      return err('Address must end with @agentlair.dev.', 400, 'invalid_address');
    }
    const localPartError = validateLocalPart(address);
    if (localPartError) {
      return err(localPartError, 400, 'invalid_address');
    }
    // CRITICAL: isReservedAddress BEFORE any KV lookup
    if (isReservedAddress(address)) {
      return err('This address is not available.', 409, 'address_unavailable');
    }
    if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
    const existing = await env.EMAILS.get('email-owner:' + address);
    if (existing) {
      return err('This address is not available.', 409, 'address_unavailable');
    }
    emailAddress = address;
  } else if (name) {
    // ── Name-derived path ──────────────────────────────────────────────────────
    const sanitized = name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 30)
      .replace(/^-|-$/g, '');
    if (!sanitized) {
      // Edge case: name contained only special chars (e.g. '!!!') → sanitization
      // produces empty string → fall back to random address to avoid '@agentlair.dev'
      emailAddress = `agent-${nanoid(8)}@agentlair.dev`;
    } else {
      const candidate = `${sanitized}@agentlair.dev`;
      // CRITICAL: isReservedAddress BEFORE any KV lookup
      if (isReservedAddress(candidate)) {
        return err('This address is not available.', 409, 'address_unavailable');
      }
      if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
      const existing = await env.EMAILS.get('email-owner:' + candidate);
      if (existing) {
        // Try 4-digit suffix fallback
        const suffix = Math.floor(1000 + Math.random() * 9000).toString();
        const fallback = `${sanitized.slice(0, 25)}-${suffix}@agentlair.dev`;
        const fallbackExisting = await env.EMAILS.get('email-owner:' + fallback);
        if (fallbackExisting) {
          return err('This address is not available.', 409, 'address_unavailable');
        }
        emailAddress = fallback;
      } else {
        emailAddress = candidate;
      }
    }
  } else {
    // ── Random fallback path ───────────────────────────────────────────────────
    // agent- prefix is not reserved
    emailAddress = `agent-${nanoid(8)}@agentlair.dev`;
  }

  // Create account
  const keyValue = 'al_live_' + nanoid(32);
  const keyHash = await sha256hex(keyValue);
  const keyPrefix = keyValue.slice(0, 12);
  const accountId = 'acc_' + nanoid(16);
  const now = new Date().toISOString();

  // Determine account status based on recovery_email
  const accountStatus = recovery_email ? 'restricted' : 'unverified';

  const newAccount: Record<string, unknown> = {
    id: accountId,
    key_prefix: keyPrefix,
    name: name || emailAddress.split('@')[0],
    tier: 'free',
    email: recovery_email || null,
    status: accountStatus,
    ...(recovery_email && { operator_email: recovery_email }),
    created_at: now,
    stacks: [] as string[],
    approval_required: agentApprovalRequired,
    ...(capabilities && capabilities.length > 0 && { capabilities }),
  };

  // KV writes — wrapped in try/catch to handle quota limits gracefully.
  try {
    await env.KEYS.put('key:' + keyHash, JSON.stringify(newAccount));
    await env.KEYS.put('account:' + accountId, keyHash);

    // Claim email address
    if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
    await env.EMAILS.put('email-owner:' + emailAddress, accountId);

    // Update per-account address index for instant consistency
    const addrIndexKey = `account-addresses:${accountId}`;
    const addrRaw = await env.EMAILS.get(addrIndexKey);
    const addrList: string[] = addrRaw ? JSON.parse(addrRaw) : [];
    if (!addrList.includes(emailAddress)) {
      addrList.push(emailAddress);
      await env.EMAILS.put(addrIndexKey, JSON.stringify(addrList));
    }

    // Optional: register E2E public key
    if (public_key) {
      await env.EMAILS.put('email-pubkey:' + emailAddress, public_key);
    }

    // Optional: index by recovery email for magic link lookup
    if (recovery_email) {
      await env.KEYS.put('recovery-email:' + recovery_email.toLowerCase(), accountId);
      // Increment agent count for this operator email (non-blocking, fail-open)
      void incrementAgentCount(env, recovery_email);
    }
  } catch (kvErr: unknown) {
    const msg = kvErr instanceof Error ? kvErr.message : '';
    if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
      return err('Registration temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
    }
    throw kvErr;
  }

  await bumpAgentStats(env);

  // OTP flow: send verification email to operator when recovery_email is present
  let otpEmailSent = false;
  if (recovery_email) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await sha256hex(otp);
    const otpExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const otpRecord: Record<string, unknown> = {
      otp_hash: otpHash,
      expires_at: otpExpiry,
      operator_email: recovery_email,
      attempts: 0,
      otp_email_sent: false,
    };

    try {
      await env.KEYS.put('register-otp:' + accountId, JSON.stringify(otpRecord), { expirationTtl: 1800 });

      // Send OTP email to operator
      const resendKey = env.RESEND_API_KEY;
      if (resendKey) {
        const agentDisplayName = name || emailAddress.split('@')[0];
        const emailBody = `An AI agent named '${agentDisplayName}' has registered at AgentLair\nusing your email address as the operator contact.\n\nIf you authorized this registration, share this verification code with your agent:\n\n${otp}\n\nThis code expires in 30 minutes.\n\nIf you did not authorize this registration, you can ignore this email.\nThe agent will remain in restricted mode until verified.\n\n— AgentLair`;

        const sendResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'noreply@agentlair.dev',
            to: [recovery_email],
            subject: `AgentLair: Verify your agent '${agentDisplayName}'`,
            text: emailBody,
          }),
        });

        if (sendResp.ok) {
          otpEmailSent = true;
          // Update otp_email_sent in KV record
          otpRecord.otp_email_sent = true;
          await env.KEYS.put('register-otp:' + accountId, JSON.stringify(otpRecord), { expirationTtl: 1800 });
        }
      }
    } catch {
      // OTP email failure is non-fatal — log and continue
      console.error('[register] OTP email send failed for account', accountId);
    }
  }

  // Build response
  const agentHandle = emailAddress.split('@')[0];
  const responseBody: Record<string, unknown> = {
    api_key: keyValue,
    account_id: accountId,
    email_address: emailAddress,
    profile_url: `https://agentlair.dev/agents/${agentHandle}`,
    profile_note: 'Agent discovery page — public access is x402-gated (0.005 USDC/view). Share this URL to advertise your agent for paid discovery.',
    tier: 'free',
    status: accountStatus,
    created_at: now,
    warning: 'Save your API key — it will not be shown again.',
    limits: { emails_per_day: 10, requests_per_day: 100 },
  };

  if (accountStatus === 'restricted' && recovery_email) {
    responseBody.restrictions = {
      outbound_email_recipients: [recovery_email],
      note: 'Send POST /v1/register/verify with your operator OTP to remove restrictions',
    };
    responseBody.next_steps = [
      `Your operator (${recovery_email}) has received a verification email with an OTP code`,
      'Ask your operator for the 6-digit OTP code',
      'POST /v1/register/verify with {"otp": "XXXXXX"} to unlock full capabilities',
      'GET /v1/account/me to check your current status',
      'Visit https://agentlair.dev/dashboard to view your account and inbox',
    ];
    if (!otpEmailSent) {
      responseBody.otp_email_sent = false;
    }
  } else {
    responseBody.status_note = 'Free tier is fully functional. "unverified" simply means no operator email is linked — all core features work normally. Verification unlocks custom domains.';
    responseBody.next_steps = [
      'GET /v1/account/me to verify your account',
      'POST /v1/email/send to send your first email',
      'PUT /v1/vault/{key} to store credentials (body: {"ciphertext": "..."})',
      'Visit https://agentlair.dev/dashboard to view your account, inbox, and activity',
    ];
  }

  // Write welcome email directly to new agent's inbox (non-blocking)
  try {
    const welcomeBody = `Welcome to AgentLair, ${agentHandle}!

Your API key: ${keyValue}
(Save this — it won't be shown again.)

Quickstart (Node / Bun):

  const res = await fetch('https://agentlair.dev/v1/email/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ${keyValue}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '${emailAddress}',
      to: ['you@example.com'],
      subject: 'Hello from my AI agent',
      text: 'This email was sent by an AI agent via AgentLair.',
    }),
  });

Your email address: ${emailAddress}
Your profile:       https://agentlair.dev/agents/${agentHandle}
Getting started:    https://agentlair.dev/getting-started
Dashboard:          https://agentlair.dev/dashboard

— AgentLair Team`;
    const welcomeMsgId = nanoid(16);
    const welcomeMsgKey = `msg:${emailAddress}:${welcomeMsgId}`;
    const syntheticMsgId = `<welcome-${welcomeMsgId}@agentlair.dev>`;
    const { value: encBody, encrypted } = await encryptEmailField(env, welcomeBody);
    const welcomeMsg = {
      message_id: syntheticMsgId,
      from: 'AgentLair <welcome@agentlair.dev>',
      to: emailAddress,
      subject: `Welcome to AgentLair, ${agentHandle}!`,
      body: encBody,
      body_encrypted: encrypted,
      body_preview: welcomeBody.substring(0, 120).replace(/\n/g, ' '),
      received_at: now,
      read: false,
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', authenticated: true, method: 'internal' },
    };
    await env.EMAILS.put(welcomeMsgKey, JSON.stringify(welcomeMsg), { expirationTtl: 30 * 24 * 3600 });
    // Update inbox index
    const indexKey = `index:${emailAddress}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    index.unshift(welcomeMsgKey);
    await env.EMAILS.put(indexKey, JSON.stringify(index.slice(0, 500)), { expirationTtl: 30 * 24 * 3600 });
  } catch (e) {
    console.error('[register] Welcome email write failed:', e);
  }

  return json(responseBody, 201);
}
