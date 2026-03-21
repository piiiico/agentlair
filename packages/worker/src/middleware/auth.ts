// ─── Auth Middleware ───────────────────────────────────────────────────────────

import type { Env } from '../types.js';
import { sha256hex } from '../utils.js';
import { getEmailProvider } from '../email-provider.js';

export async function authenticate(request: Request, env: Env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  if (!key.startsWith('al_')) return null;

  const hash = await sha256hex(key);
  const accountJson = await env.KEYS.get('key:' + hash);
  if (!accountJson) return null;

  return JSON.parse(accountJson);
}

// ─── Session Auth (dashboard) ──────────────────────────────────────────────────
// Session tokens are prefixed "session_" and stored as KV keys with 24h TTL.

export async function authenticateSession(request: Request, env: Env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer session_')) return null;
  const token = auth.slice(7); // keep "session_..." prefix
  const tokenHash = await sha256hex(token);
  const sessionJson = await env.KEYS.get('session:' + tokenHash);
  if (!sessionJson) return null;
  const session = JSON.parse(sessionJson);
  if (session.expires && Date.now() > session.expires) {
    await env.KEYS.delete('session:' + tokenHash);
    return null;
  }
  // Load the account
  const keyHash = await env.KEYS.get('account:' + session.accountId);
  if (!keyHash) return null;
  const accountJson = await env.KEYS.get('key:' + keyHash);
  if (!accountJson) return null;
  return { ...JSON.parse(accountJson), _session: token };
}

// Authenticate with either API key or session token
export async function authenticateAny(request: Request, env: Env) {
  const byApiKey = await authenticate(request, env);
  if (byApiKey) return byApiKey;
  return await authenticateSession(request, env);
}

export async function sendMagicLinkEmail(toEmail: string, token: string, baseUrl: string, env: Env) {
  const link = baseUrl + '/v1/auth/verify?token=' + token;
  const provider = getEmailProvider(env);
  if (!provider) throw new Error('No email provider configured');
  await provider.send({
    from: 'AgentLair <noreply@agentlair.dev>',
    to: [toEmail],
    subject: 'Your AgentLair dashboard login link',
    text: 'Click this link to log in to your AgentLair dashboard (expires in 15 minutes):\n\n' + link + '\n\nIf you did not request this, ignore this email.',
    html: '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0f;color:#e8e8f0;padding:2rem;"><div style="max-width:480px;margin:0 auto;"><h2 style="color:#6366f1;">AgentLair Dashboard Login</h2><p>Click the button below to log in. This link expires in <strong>15 minutes</strong>.</p><p style="margin:1.5rem 0;"><a href="' + link + '" style="background:#6366f1;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;">Log in to Dashboard</a></p><p style="color:#888;font-size:0.85rem;">Or copy this link: ' + link + '</p><p style="color:#555;font-size:0.8rem;margin-top:2rem;">If you did not request this, ignore this email.</p></div></body></html>',
  }, env);
}

// ─── Vault: Recovery Email ────────────────────────────────────────────────────

export async function sendVaultRecoveryEmail(toEmail: string, token: string, baseUrl: string, env: Env) {
  const link = baseUrl + '/v1/vault/recover/verify?token=' + token;
  const provider = getEmailProvider(env);
  if (!provider) throw new Error('No email provider configured');
  await provider.send({
    from: 'AgentLair <noreply@agentlair.dev>',
    to: [toEmail],
    subject: 'AgentLair Vault Recovery',
    text: 'Click this link to retrieve your encrypted vault data (expires in 15 minutes):\n\n' + link + '\n\nYour seed is encrypted — AgentLair cannot read it. You will need your passphrase to decrypt it after retrieval.\n\nIf you did not request this, ignore this email.',
    html: '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0f;color:#e8e8f0;padding:2rem;"><div style="max-width:480px;margin:0 auto;"><h2 style="color:#6366f1;">AgentLair Vault Recovery</h2><p>Click the button below to retrieve your encrypted vault data. This link expires in <strong>15 minutes</strong>.</p><p style="color:#888;font-size:0.9rem;margin-bottom:1rem;">Your seed is encrypted — AgentLair cannot read it. You will need your passphrase to decrypt it after retrieval.</p><p style="margin:1.5rem 0;"><a href="' + link + '" style="background:#6366f1;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;">Retrieve Encrypted Seed</a></p><p style="color:#888;font-size:0.85rem;">Or copy this link: ' + link + '</p><p style="color:#555;font-size:0.8rem;margin-top:2rem;">If you did not request this, ignore this email.</p></div></body></html>',
  }, env);
}
