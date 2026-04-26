// ─── POST /v1/register/verify — OTP Verification ─────────────────────────────
// Verifies agent registration via OTP sent to the operator's recovery email.
// Transitions account from 'restricted' → 'verified', unlocking full capabilities.
//
// Requires Bearer authentication (agent must be registered and in restricted mode).

import { sha256hex, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';

interface OtpRecord {
  otp_hash: string;
  expires_at: string;
  operator_email: string;
  attempts: number;
  otp_email_sent?: boolean;
}

export async function handleRegisterVerifyRoute(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { path, method, account }: RouteContext,
): Promise<Response | null> {
  if (path !== '/v1/register/verify' || method !== 'POST') return null;

  // Require auth
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Already verified check
  if (account.status === 'verified') {
    return err('Account is already verified.', 409, 'already_verified');
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch {}

  const otp = typeof body.otp === 'string' ? body.otp.trim() : undefined;
  if (!otp) {
    return err('Required: otp (6-digit verification code)', 400, 'missing_otp');
  }

  // Load OTP record
  const otpKey = 'register-otp:' + account.id;
  const otpRaw = await env.KEYS.get(otpKey);
  if (!otpRaw) {
    return err('No pending verification. Register first with a recovery_email.', 400, 'otp_not_found');
  }

  const otpRecord = JSON.parse(otpRaw) as OtpRecord;

  // Check max attempts
  if (otpRecord.attempts >= 5) {
    await env.KEYS.delete(otpKey);
    return err('Too many failed attempts. The OTP has been invalidated.', 400, 'otp_max_attempts');
  }

  // Check expiry
  if (new Date(otpRecord.expires_at) <= new Date()) {
    await env.KEYS.delete(otpKey);
    return err('OTP expired. Register again with a recovery_email to get a new OTP.', 400, 'otp_expired');
  }

  // Verify OTP
  const submittedHash = await sha256hex(otp);
  if (submittedHash !== otpRecord.otp_hash) {
    // Increment attempts
    otpRecord.attempts += 1;
    const remaining = 5 - otpRecord.attempts;

    if (otpRecord.attempts >= 5) {
      await env.KEYS.delete(otpKey);
    } else {
      // Re-calculate TTL from remaining time
      const remainingTtlMs = new Date(otpRecord.expires_at).getTime() - Date.now();
      const remainingTtlSec = Math.max(1, Math.floor(remainingTtlMs / 1000));
      await env.KEYS.put(otpKey, JSON.stringify(otpRecord), { expirationTtl: remainingTtlSec });
    }

    return err(`Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`, 400, 'invalid_otp');
  }

  // OTP is valid — update account to verified
  const keyHash = await env.KEYS.get('account:' + account.id);
  if (!keyHash) {
    return err('Account not found.', 404, 'account_not_found');
  }

  const accountRaw = await env.KEYS.get('key:' + keyHash);
  if (!accountRaw) {
    return err('Account data not found.', 404, 'account_not_found');
  }

  const accountData = JSON.parse(accountRaw) as Record<string, unknown>;
  const verifiedAt = new Date().toISOString();
  accountData.status = 'verified';
  accountData.status_updated_at = verifiedAt;
  accountData.verified_at = verifiedAt;

  await env.KEYS.put('key:' + keyHash, JSON.stringify(accountData));

  // Delete OTP record
  await env.KEYS.delete(otpKey);

  // Get email address for response
  let emailAddress: string | undefined;
  if (env.EMAILS) {
    const addrRaw = await env.EMAILS.get('account-addresses:' + account.id);
    if (addrRaw) {
      const addrs = JSON.parse(addrRaw) as string[];
      emailAddress = addrs[0];
    }
  }

  return json({
    status: 'verified',
    account_id: account.id,
    email_address: emailAddress || null,
    verified_at: verifiedAt,
    capabilities_unlocked: ['outbound_email_any_recipient'],
    next_steps: [
      'POST /v1/email/send to send email to any recipient',
      'GET /v1/account/me to view your verified account',
      'PUT /v1/vault/{key} to store credentials (body: {"ciphertext": "..."})',
    ],
  }, 200);
}
