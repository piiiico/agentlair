// ─── Task Delegation Routes ──────────────────────────────────────────────────
// Handles: POST /v1/tasks — delegate tasks to other AgentLair agents via email
//
// Tasks are structured email messages delivered to the target agent's inbox.
// The API provides task IDs and audit trail; email is the delivery backend.
// Follows the same auth, rate limiting, and x402 patterns as email send.

import { nanoid, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';
import { checkEmailRateLimit, recordEmailSent } from '../middleware/ratelimit.js';
import { X402_CONFIG, EMAIL_PAYMENT_REQUIRED_RESPONSE, verifyX402Payment, settleX402Payment, trackX402Spend, autoUpgradeIfThreshold, SERVICE_PRICES, checkSpendingCap } from '../x402.js';
import { verifyAgentKit, recordAgentkitUsage, AGENTKIT_FREE_TRIAL_USES } from '../middleware/agentkit.js';
import { recordBudgetSpend } from '../middleware/budget.js';
import { getAccountAddresses } from './email.js';

// ─── Request body type ──────────────────────────────────────────────────────

interface TaskCreateBody {
  to?: string;
  task?: string;
  context?: string;
  priority?: string;
  constraints?: string;
}

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const MAX_TASK_LENGTH = 10_000;
const MAX_CONTEXT_LENGTH = 50_000;

// ─── Route handler ──────────────────────────────────────────────────────────

export async function handleTaskRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  rc: RouteContext,
): Promise<Response | null> {
  const { path, method, account } = rc;

  // POST /v1/tasks — delegate a task to another agent
  if (path === '/v1/tasks' && method === 'POST') {
    if (!account) {
      return err('Authentication required.', 401, 'unauthorized');
    }

    // Parse body
    let body: TaskCreateBody = {};
    try {
      body = (await request.json()) as TaskCreateBody;
    } catch {
      return err('Invalid JSON body', 400, 'invalid_body');
    }

    const { to, task, context: taskContext, priority, constraints } = body;

    // ── Validate required fields ─────────────────────────────────────────────
    if (!to || typeof to !== 'string') {
      return err('Required: "to" — target agent\'s @agentlair.dev email address', 400, 'missing_to');
    }
    if (!task || typeof task !== 'string') {
      return err('Required: "task" — what you want the agent to do', 400, 'missing_task');
    }

    // Validate 'to' is an @agentlair.dev address
    const normalizedTo = to.toLowerCase().trim();
    if (!normalizedTo.endsWith('@agentlair.dev')) {
      return err('Target must be an @agentlair.dev address', 400, 'invalid_to');
    }

    // Validate field lengths
    if (task.length > MAX_TASK_LENGTH) {
      return err(`Task must be ${MAX_TASK_LENGTH} characters or fewer`, 400, 'task_too_long');
    }
    if (taskContext && typeof taskContext === 'string' && taskContext.length > MAX_CONTEXT_LENGTH) {
      return err(`Context must be ${MAX_CONTEXT_LENGTH} characters or fewer`, 400, 'context_too_long');
    }

    // Validate priority
    const effectivePriority = priority || 'normal';
    if (!VALID_PRIORITIES.includes(effectivePriority)) {
      return err(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`, 400, 'invalid_priority');
    }

    // ── Verify target address exists ─────────────────────────────────────────
    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const targetOwner = await env.EMAILS.get(`email-owner:${normalizedTo}`);
    if (!targetOwner) {
      return err(`Target address "${normalizedTo}" is not claimed by any account`, 404, 'target_not_found');
    }

    // ── Verify sender has a claimed @agentlair.dev address ───────────────────
    const senderAddresses = await getAccountAddresses(env, account.id);
    const senderAgentlairAddr = senderAddresses.find(addr => addr.endsWith('@agentlair.dev'));
    if (!senderAgentlairAddr) {
      return err(
        'You must claim an @agentlair.dev address before delegating tasks. Use POST /v1/email/claim.',
        400,
        'no_sender_address',
      );
    }

    // ── Rate limiting (same bucket as email_send) ────────────────────────────
    const emailRateCheck = await checkEmailRateLimit(env, account.id, account.tier || 'free', senderAgentlairAddr);
    let paidViaX402 = false;
    let paidViaAgentKit = false;
    let agentkitHumanId: string | null = null;
    let x402PaymentHeader: string | null = null;
    let x402Payer: string | undefined;

    if (!emailRateCheck.allowed) {
      if (emailRateCheck.reason === 'address_suspended') {
        return new Response(JSON.stringify({
          error: emailRateCheck.reason,
          message: emailRateCheck.upgrade_hint || 'Address suspended.',
          limit: emailRateCheck.limit,
          reset_at: emailRateCheck.reset_at,
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ── AgentKit free-trial check ────────────────────────────────────────
      const agentkitResult = await verifyAgentKit(request, env, '/v1/tasks');
      if (agentkitResult.verified) {
        if (agentkitResult.hasFreeUses) {
          paidViaAgentKit = true;
          agentkitHumanId = agentkitResult.humanId;
        }
      } else if (agentkitResult.reason !== 'no_header') {
        return new Response(JSON.stringify({
          error: 'agentkit_verification_failed',
          reason: agentkitResult.reason,
          message: `AgentKit verification failed: ${('error' in agentkitResult && agentkitResult.error) || agentkitResult.reason}`,
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ── x402 payment check ───────────────────────────────────────────────
      if (!paidViaAgentKit) {
        x402PaymentHeader = request.headers.get('X-PAYMENT');

        if (!x402PaymentHeader) {
          const retryAfter = emailRateCheck.reset_at
            ? String(Math.max(1, Math.floor((new Date(emailRateCheck.reset_at).getTime() - Date.now()) / 1000)))
            : '60';
          return new Response(JSON.stringify({
            ...EMAIL_PAYMENT_REQUIRED_RESPONSE,
            rate_limit: {
              reason: emailRateCheck.reason,
              limit: emailRateCheck.limit,
              reset_at: emailRateCheck.reset_at,
              upgrade_url: 'https://agentlair.dev/pricing',
            },
            agentkit: {
              hint: 'Human-verified agents get ' + AGENTKIT_FREE_TRIAL_USES + ' free tasks. Pass X-AGENTKIT header with signed proof.',
              docs: 'https://docs.world.org/agents/agent-kit',
            },
          }), {
            status: 402,
            headers: {
              'Content-Type': 'application/json',
              'X-402-Version': String(X402_CONFIG.x402Version),
              'X-RateLimit-Limit': String(emailRateCheck.limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': emailRateCheck.reset_at || '',
              'Retry-After': retryAfter,
            },
          });
        }

        const verification = await verifyX402Payment(x402PaymentHeader);
        if (!verification.valid) {
          return new Response(JSON.stringify({
            error: 'payment_invalid',
            message: verification.error,
          }), {
            status: 402,
            headers: { 'Content-Type': 'application/json', 'X-402-Version': String(X402_CONFIG.x402Version) },
          });
        }

        // Check spending caps for pod accounts
        if (account.type === 'pod' && account.pod_id) {
          try {
            const podRaw = await env.KEYS.get('pod:' + account.pod_id);
            if (podRaw) {
              const pod = JSON.parse(podRaw);
              if (pod.spending_caps) {
                const capCheck = await checkSpendingCap(env, account.id, SERVICE_PRICES.email_send.amount, pod.spending_caps);
                if (!capCheck.allowed) {
                  const periodLabel = capCheck.exceeded || 'period';
                  const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                  const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                  return new Response(JSON.stringify({
                    error: `Spending cap exceeded: ${periodLabel} limit of ${capUsdc} USDC reached (current: ${currentUsdc} USDC).`,
                    code: 'spending_cap_exceeded',
                    cap: { period: periodLabel, limit_usdc: capUsdc, current_usdc: currentUsdc },
                  }), {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' },
                  });
                }
              }
            }
          } catch { /* fail-open */ }
        }

        x402Payer = verification.payer;
        paidViaX402 = true;
      }
    }

    // ── Generate task ID and format email ─────────────────────────────────────
    const taskId = 'tsk_' + nanoid(16);
    const now = new Date().toISOString();

    // Truncate task for subject line (max ~80 chars)
    const subjectTask = task.length > 70 ? task.slice(0, 67) + '...' : task;
    const subject = `[TASK:${taskId}] ${subjectTask}`;

    // Build structured email body: YAML frontmatter + markdown
    let emailBody = `---\ntask_id: ${taskId}\nfrom_account: ${account.id}\npriority: ${effectivePriority}\nsubmitted_at: ${now}\n---\n\n## Task\n${task}\n`;

    if (taskContext) {
      emailBody += `\n## Context\n${taskContext}\n`;
    }
    if (constraints) {
      emailBody += `\n## Constraints\n${constraints}\n`;
    }

    // ── Deliver via intra-domain path (both addresses are @agentlair.dev) ────
    // Since both sender and recipient are @agentlair.dev, we deliver directly
    // to the recipient's inbox in KV (same as email send's internal delivery).

    const syntheticMessageId = `<${taskId}@agentlair.dev>`;
    const inboxTs = Date.now();
    const inboxKey = `inbox:${targetOwner}:${inboxTs}:${taskId}`;

    const inboxEntry = {
      message_id: syntheticMessageId,
      from: senderAgentlairAddr,
      to: [normalizedTo],
      subject,
      text: emailBody,
      received_at: now,
      read: false,
      archived: false,
      thread_id: syntheticMessageId.replace(/[<>]/g, '').trim(),
    };

    await env.EMAILS.put(inboxKey, JSON.stringify(inboxEntry), { expirationTtl: 30 * 24 * 3600 });

    // Update recipient's inbox index
    const indexKey = `index:${normalizedTo}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    const indexEntries: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    indexEntries.unshift(inboxKey);
    // Cap index at 500 entries
    await env.EMAILS.put(indexKey, JSON.stringify(indexEntries.slice(0, 500)), { expirationTtl: 90 * 24 * 3600 });

    // Notify recipient via WebSocket (Durable Object)
    try {
      const notifierId = env.INBOX_NOTIFIER.idFromName(targetOwner);
      const notifier = env.INBOX_NOTIFIER.get(notifierId);
      ctx.waitUntil(notifier.fetch(new Request('https://internal/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'task', task_id: taskId, from: senderAgentlairAddr }),
      })));
    } catch { /* non-fatal */ }

    // ── Record rate limit usage ──────────────────────────────────────────────
    ctx.waitUntil(recordEmailSent(env, senderAgentlairAddr));

    // ── Track payments ───────────────────────────────────────────────────────
    if (paidViaAgentKit && agentkitHumanId) {
      ctx.waitUntil(recordAgentkitUsage(env, '/v1/tasks', agentkitHumanId));
    }
    if (paidViaX402 && x402PaymentHeader) {
      ctx.waitUntil((async () => {
        try {
          await settleX402Payment(x402PaymentHeader!);
          const spend = await trackX402Spend(env, account.id, SERVICE_PRICES.email_send.amount, { payer: x402Payer, service: 'task_delegate' });
          await autoUpgradeIfThreshold(env, account, spend);
        } catch { /* non-fatal */ }
      })());
    }

    // Record budget spend
    ctx.waitUntil(recordBudgetSpend(env, account.id, parseInt(SERVICE_PRICES.email_send.amount)));

    return json({
      task_id: taskId,
      status: 'delivered',
      delivered_to: normalizedTo,
      delivered_via: 'email',
    }, 202);
  }

  return null;
}
