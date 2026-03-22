// ─── Webhook Routes ───────────────────────────────────────────────────────────
// Handles: /v1/email/webhooks — webhook registration and management
//
// All routes require authentication (account !== null).
//
//   POST   /v1/email/webhooks         — register a webhook for an address
//   GET    /v1/email/webhooks         — list webhooks for this account
//   DELETE /v1/email/webhooks/{id}    — remove a webhook

import { nanoid, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';

export async function handleWebhookRoutes(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { path, method, account }: RouteContext,
): Promise<Response | null> {

  // Only match /v1/email/webhooks paths
  if (!path.startsWith('/v1/email/webhooks')) return null;

  // Webhooks are protected
  if (!account) return null;

  if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

  // POST /v1/email/webhooks — register a webhook
  if (path === '/v1/email/webhooks' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const address = typeof body.address === 'string' ? body.address : undefined;
    const webhookUrl = typeof body.url === 'string' ? body.url : undefined;
    const secret = typeof body.secret === 'string' ? body.secret : undefined;

    if (!address || !webhookUrl) {
      return err('address and url are required.', 400, 'missing_params');
    }
    if (!address.endsWith('@agentlair.dev')) {
      return err('Only @agentlair.dev addresses are supported.', 400, 'invalid_address');
    }
    try { new URL(webhookUrl); } catch {
      return err('url must be a valid URL (https://...).', 400, 'invalid_url');
    }

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (currentOwner && currentOwner !== account.id) {
      return err('This address belongs to another account.', 403, 'address_not_yours');
    }

    const id = `wh_${nanoid(16)}`;
    const hookObj = {
      id,
      account_id: account.id,
      address,
      url: webhookUrl,
      secret: secret || null,
      created_at: new Date().toISOString(),
    };

    await env.EMAILS.put(`webhook:${id}`, JSON.stringify(hookObj), { expirationTtl: 365 * 24 * 3600 });

    const addrIndexKey = `webhook-addr:${address}`;
    let addrIndex: string[] = [];
    try {
      const raw = await env.EMAILS.get(addrIndexKey);
      if (raw) addrIndex = JSON.parse(raw);
    } catch {}
    if (!addrIndex.includes(id)) addrIndex.push(id);
    await env.EMAILS.put(addrIndexKey, JSON.stringify(addrIndex), { expirationTtl: 365 * 24 * 3600 });

    const acctIndexKey = `account-webhooks:${account.id}`;
    let acctIndex: string[] = [];
    try {
      const raw = await env.EMAILS.get(acctIndexKey);
      if (raw) acctIndex = JSON.parse(raw);
    } catch {}
    if (!acctIndex.includes(id)) acctIndex.push(id);
    await env.EMAILS.put(acctIndexKey, JSON.stringify(acctIndex), { expirationTtl: 365 * 24 * 3600 });

    return json({
      id,
      address,
      url: webhookUrl,
      has_secret: !!secret,
      signature_header: 'X-AgentLair-Signature',
      signature_format: 'sha256=<hmac-sha256-hex-of-json-body>',
      events: ['email.received'],
      created_at: hookObj.created_at,
      note: 'AgentLair will POST email.received events to your URL within seconds of inbound delivery.',
    }, 201);
  }

  // GET /v1/email/webhooks — list webhooks for this account
  if (path === '/v1/email/webhooks' && method === 'GET') {
    const filterAddress = (new URL(request.url)).searchParams.get('address');

    const acctIndexKey = `account-webhooks:${account.id}`;
    const acctIndexRaw = await env.EMAILS.get(acctIndexKey);
    if (!acctIndexRaw) return json({ webhooks: [], count: 0 });

    const ids = JSON.parse(acctIndexRaw);
    const hooks = (await Promise.all(ids.map(async (wid: string) => {
      const raw = await env.EMAILS.get(`webhook:${wid}`);
      if (!raw) return null;
      const h = JSON.parse(raw);
      return {
        id: h.id,
        address: h.address,
        url: h.url,
        has_secret: !!h.secret,
        events: ['email.received'],
        created_at: h.created_at,
      };
    }))).filter(Boolean);

    const filtered = filterAddress ? hooks.filter((h) => h && h.address === filterAddress) : hooks;
    return json({ webhooks: filtered, count: filtered.length });
  }

  // DELETE /v1/email/webhooks/{id} — remove a webhook
  if (path.startsWith('/v1/email/webhooks/') && method === 'DELETE') {
    const hookId = path.replace('/v1/email/webhooks/', '');
    if (!hookId) return err('Webhook ID required.', 400, 'missing_params');

    const hookRaw = await env.EMAILS.get(`webhook:${hookId}`);
    if (!hookRaw) return err('Webhook not found.', 404, 'not_found');

    const hook = JSON.parse(hookRaw);
    if (hook.account_id !== account.id) return err('Not your webhook.', 403, 'forbidden');

    await env.EMAILS.delete(`webhook:${hookId}`);

    try {
      const addrIndexKey = `webhook-addr:${hook.address}`;
      const raw = await env.EMAILS.get(addrIndexKey);
      if (raw) {
        const ids = JSON.parse(raw).filter((wid: string) => wid !== hookId);
        await env.EMAILS.put(addrIndexKey, JSON.stringify(ids), { expirationTtl: 365 * 24 * 3600 });
      }
    } catch {}

    try {
      const acctIndexKey = `account-webhooks:${account.id}`;
      const raw = await env.EMAILS.get(acctIndexKey);
      if (raw) {
        const ids = JSON.parse(raw).filter((wid: string) => wid !== hookId);
        await env.EMAILS.put(acctIndexKey, JSON.stringify(ids), { expirationTtl: 365 * 24 * 3600 });
      }
    } catch {}

    return json({ deleted: true, id: hookId });
  }

  // Unmatched /v1/email/webhooks/* route
  return err('Method not allowed for webhook route.', 405, 'method_not_allowed');
}
