/**
 * @agentlair/sdk — AgentLair + AgentLairClient
 *
 * `AgentLair` is the primary class. Accepts an API key string directly.
 * `AgentLairClient` is the legacy class (accepts options object) — still fully supported.
 *
 * @example Three-line onboarding
 * const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
 * const inbox = await lair.email.claim('my-agent');  // auto-expands to my-agent@agentlair.dev
 * const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
 *
 * @example Full flow
 * // Create a new account (no API key needed)
 * const { api_key } = await AgentLair.createAccount({ name: 'my-agent' });
 *
 * const lair = new AgentLair(api_key);
 * await lair.email.claim('my-agent');
 * await lair.email.send({ from: 'my-agent@agentlair.dev', to: 'user@example.com', subject: 'Hello', text: 'Hi!' });
 * const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
 *
 * // Vault: store secrets (zero-knowledge — use @agentlair/vault-crypto to encrypt first)
 * await lair.vault.put('openai-key', { ciphertext: encryptedBlob });
 * const { ciphertext } = await lair.vault.get('openai-key');
 */

import { AgentLairError } from './errors.js';
import type {
  AccountMeResult,
  AgentLairOptions,
  ApprovalActionResult,
  BillingResult,
  BudgetApproval,
  BudgetChargeOptions,
  BudgetChargeResult,
  BudgetResult,
  BudgetSetOptions,
  CalendarFeedResult,
  ClaimAddressOptions,
  ClaimAddressResult,
  CreateAccountOptions,
  CreateAccountResult,
  CreateCalendarEventOptions,
  CreateCalendarEventResult,
  DeleteCalendarEventResult,
  DeleteMessageResult,
  DeleteWebhookResult,
  FullMessage,
  GetInboxOptions,
  GetInboxResult,
  ListAddressesResult,
  ListApprovalsResult,
  ListCalendarEventsOptions,
  ListCalendarEventsResult,
  ListWebhooksOptions,
  ListWebhooksResult,
  Observation,
  ObservationsTopicsResult,
  OutboxResult,
  ReadMessageOptions,
  ReadObservationsOptions,
  ReadObservationsResult,
  RegisterWebhookOptions,
  SendEmailOptions,
  SendEmailResult,
  Stack,
  CreateStackOptions,
  ListStacksResult,
  UpdateMessageOptions,
  UpdateMessageResult,
  UsageResult,
  VaultDeleteOptions,
  VaultDeleteResult,
  VaultGetOptions,
  VaultGetResult,
  VaultListResult,
  VaultPutOptions,
  VaultPutResult,
  WriteObservationOptions,
} from './types.js';

const DEFAULT_BASE_URL = 'https://agentlair.dev';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Expand a short name like "my-agent" to "my-agent@agentlair.dev".
 * If the address already contains "@", returns it as-is.
 */
function expandAddress(address: string): string {
  return address.includes('@') ? address : `${address}@agentlair.dev`;
}

// ─── Internal request helper (shared by both classes) ─────────────────────────

async function makeRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; auth?: string | null } = {},
): Promise<T> {
  const url = new URL(baseUrl + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (opts.auth !== null) {
    headers['Authorization'] = `Bearer ${opts.auth ?? apiKey}`;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const body = data as { error?: string; message?: string };
    throw new AgentLairError(
      body?.message ?? `HTTP ${response.status}`,
      response.status,
      body?.error ?? 'error',
    );
  }

  return data as T;
}

// ─── RequestFn type ───────────────────────────────────────────────────────────

type RequestFn = <T>(
  method: string,
  path: string,
  opts?: { body?: unknown; query?: Record<string, string> },
) => Promise<T>;

// ─── WebhooksNamespace ────────────────────────────────────────────────────────

class WebhooksNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Register a webhook URL to receive real-time `email.received` events.
   *
   * @example
   * const hook = await lair.email.webhooks.create({
   *   address: 'my-agent@agentlair.dev',
   *   url: 'https://myserver.com/webhook',
   *   secret: 'my-secret',
   * });
   */
  async create(options: RegisterWebhookOptions): Promise<{ id: string; address: string; url: string; created_at: string }> {
    return this._req('POST', '/v1/email/webhooks', {
      body: { ...options, address: expandAddress(options.address) },
    });
  }

  /**
   * List registered webhooks, optionally filtered by address.
   *
   * @example
   * const { webhooks } = await lair.email.webhooks.list();
   */
  async list(options: ListWebhooksOptions = {}): Promise<ListWebhooksResult> {
    const query: Record<string, string> = {};
    if (options.address) query.address = expandAddress(options.address);
    return this._req('GET', '/v1/email/webhooks', { query });
  }

  /**
   * Delete a webhook by ID.
   *
   * @example
   * await lair.email.webhooks.delete('wh_abc123');
   */
  async delete(id: string): Promise<DeleteWebhookResult> {
    return this._req('DELETE', `/v1/email/webhooks/${encodeURIComponent(id)}`);
  }
}

// ─── EmailNamespace ───────────────────────────────────────────────────────────

class EmailNamespace {
  /** Webhook management: webhooks.create / webhooks.list / webhooks.delete */
  readonly webhooks: WebhooksNamespace;

  constructor(private readonly _req: RequestFn) {
    this.webhooks = new WebhooksNamespace(_req);
  }

  /**
   * Claim an @agentlair.dev email address.
   *
   * Pass a short name (e.g. `"my-agent"`) and it auto-expands to `my-agent@agentlair.dev`.
   *
   * @example
   * await lair.email.claim('my-agent');                    // → my-agent@agentlair.dev
   * await lair.email.claim('my-agent@agentlair.dev');      // also works
   */
  async claim(address: string, options: Omit<ClaimAddressOptions, 'address'> = {}): Promise<ClaimAddressResult> {
    return this._req('POST', '/v1/email/claim', {
      body: { ...options, address: expandAddress(address) },
    });
  }

  /**
   * List all @agentlair.dev addresses claimed by this account.
   *
   * @example
   * const { addresses } = await lair.email.addresses();
   */
  async addresses(): Promise<ListAddressesResult> {
    return this._req('GET', '/v1/email/addresses');
  }

  /**
   * Get inbox messages (previews — no full body).
   * Use `read()` for the full body of a specific message.
   *
   * @example
   * const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
   * const { messages } = await lair.email.inbox('my-agent', { limit: 5 });
   */
  async inbox(address: string, options: Omit<GetInboxOptions, 'address'> = {}): Promise<GetInboxResult> {
    const query: Record<string, string> = { address: expandAddress(address) };
    if (options.limit !== undefined) query.limit = String(options.limit);
    return this._req('GET', '/v1/email/inbox', { query });
  }

  /**
   * Read the full body of a message. Marks as read.
   *
   * @example
   * const msg = await lair.email.read(inboxMsg.message_id_url, 'my-agent@agentlair.dev');
   * console.log(msg.body);
   */
  async read(messageId: string, address: string): Promise<FullMessage> {
    return this._req(
      'GET',
      `/v1/email/messages/${messageId}`,
      { query: { address: expandAddress(address) } },
    );
  }

  /**
   * Delete a message.
   *
   * @example
   * await lair.email.deleteMessage(inboxMsg.message_id_url, 'my-agent@agentlair.dev');
   */
  async deleteMessage(messageId: string, address: string): Promise<DeleteMessageResult> {
    return this._req(
      'DELETE',
      `/v1/email/messages/${messageId}`,
      { query: { address: expandAddress(address) } },
    );
  }

  /**
   * Update message properties (mark read/unread).
   *
   * @example
   * await lair.email.update(msg.message_id_url, 'my-agent@agentlair.dev', { read: false });
   */
  async update(messageId: string, address: string, options: UpdateMessageOptions): Promise<UpdateMessageResult> {
    return this._req(
      'PATCH',
      `/v1/email/messages/${messageId}`,
      { query: { address: expandAddress(address) }, body: options },
    );
  }

  /**
   * Send an email from an address you own.
   *
   * @example
   * await lair.email.send({
   *   from: 'my-agent@agentlair.dev',
   *   to: 'user@example.com',
   *   subject: 'Hello',
   *   text: 'Hi from an AI agent!',
   * });
   */
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    return this._req('POST', '/v1/email/send', { body: options });
  }

  /**
   * List sent messages (outbox).
   *
   * @example
   * const { messages } = await lair.email.outbox({ limit: 5 });
   */
  async outbox(options: { limit?: number } = {}): Promise<OutboxResult> {
    const query: Record<string, string> = {};
    if (options.limit !== undefined) query.limit = String(options.limit);
    return this._req('GET', '/v1/email/outbox', { query });
  }
}

// ─── VaultNamespace ───────────────────────────────────────────────────────────

/**
 * Zero-knowledge secret store.
 * Server stores opaque encrypted blobs — plaintext never leaves your client.
 * Use @agentlair/vault-crypto for client-side encryption.
 */
class VaultNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Store an encrypted blob (versioned, append-only).
   *
   * @example
   * await lair.vault.put('openai-key', { ciphertext: encryptedBlob });
   */
  async put(key: string, options: VaultPutOptions): Promise<VaultPutResult> {
    return this._req('PUT', `/v1/vault/${encodeURIComponent(key)}`, { body: options });
  }

  /**
   * Retrieve an encrypted blob. Returns latest version by default.
   *
   * @example
   * const { ciphertext } = await lair.vault.get('openai-key');
   * const old = await lair.vault.get('openai-key', { version: 1 });
   */
  async get(key: string, options: VaultGetOptions = {}): Promise<VaultGetResult> {
    const query: Record<string, string> = {};
    if (options.version !== undefined) query.version = String(options.version);
    return this._req('GET', `/v1/vault/${encodeURIComponent(key)}`, { query });
  }

  /**
   * List all Vault keys (metadata only).
   *
   * @example
   * const { keys, count, limit } = await lair.vault.list();
   */
  async list(): Promise<VaultListResult> {
    return this._req('GET', '/v1/vault/');
  }

  /**
   * Delete a key (all versions) or a specific version.
   *
   * @example
   * await lair.vault.delete('openai-key');
   * await lair.vault.delete('openai-key', { version: 2 });
   */
  async delete(key: string, options: VaultDeleteOptions = {}): Promise<VaultDeleteResult> {
    const query: Record<string, string> = {};
    if (options.version !== undefined) query.version = String(options.version);
    return this._req('DELETE', `/v1/vault/${encodeURIComponent(key)}`, { query });
  }
}

// ─── StacksNamespace ──────────────────────────────────────────────────────────

class StacksNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Create a domain stack. Points nameservers to AgentLair DNS.
   * Beta: DNS provisioning is stubbed. Full CF DNS integration coming Q2 2026.
   *
   * @example
   * const stack = await lair.stacks.create({ domain: 'myagent.dev' });
   */
  async create(options: CreateStackOptions): Promise<Stack> {
    return this._req('POST', '/v1/stack', { body: options });
  }

  /**
   * List all domain stacks for this account.
   *
   * @example
   * const { stacks } = await lair.stacks.list();
   */
  async list(): Promise<ListStacksResult> {
    return this._req('GET', '/v1/stack');
  }
}

// ─── CalendarNamespace ────────────────────────────────────────────────────────

class CalendarNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Create a new calendar event.
   *
   * @example
   * const event = await lair.calendar.createEvent({
   *   summary: 'Team Standup',
   *   start: '2026-03-21T10:00:00Z',
   *   end: '2026-03-21T10:30:00Z',
   *   location: 'Zoom',
   *   attendees: ['alice@example.com'],
   * });
   */
  async createEvent(options: CreateCalendarEventOptions): Promise<CreateCalendarEventResult> {
    return this._req('POST', '/v1/calendar/events', { body: options });
  }

  /**
   * List calendar events. Optionally filter by date range.
   *
   * @example
   * const { events } = await lair.calendar.listEvents({ from: '2026-03-01', to: '2026-03-31' });
   */
  async listEvents(options: ListCalendarEventsOptions = {}): Promise<ListCalendarEventsResult> {
    const query: Record<string, string> = {};
    if (options.from) query.from = options.from;
    if (options.to) query.to = options.to;
    if (options.limit !== undefined) query.limit = String(options.limit);
    return this._req('GET', '/v1/calendar/events', { query });
  }

  /**
   * Delete a calendar event by ID.
   *
   * @example
   * await lair.calendar.deleteEvent('evt_abc123');
   */
  async deleteEvent(id: string): Promise<DeleteCalendarEventResult> {
    return this._req('DELETE', `/v1/calendar/events/${encodeURIComponent(id)}`);
  }

  /**
   * Get (or generate) the public iCal subscription URL for this calendar.
   * Share this URL with Google Calendar / Apple Calendar / Outlook to subscribe.
   *
   * @example
   * const { feed_url } = await lair.calendar.getFeed();
   */
  async getFeed(): Promise<CalendarFeedResult> {
    return this._req('GET', '/v1/calendar/feed');
  }
}

// ─── ObservationsNamespace ────────────────────────────────────────────────────

class ObservationsNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Write a structured observation. Account-scoped by default.
   * Set `shared: true` to make visible to all authenticated agents.
   *
   * @example
   * await lair.observations.write({ topic: 'market-signals', content: 'BTC up 5%' });
   */
  async write(options: WriteObservationOptions): Promise<Observation> {
    return this._req('POST', '/v1/observations', { body: options });
  }

  /**
   * Read observations. Returns own + shared by default.
   *
   * @example
   * const { observations } = await lair.observations.read({ topic: 'market-signals' });
   * const shared = await lair.observations.read({ scope: 'shared' });
   */
  async read(options: ReadObservationsOptions = {}): Promise<ReadObservationsResult> {
    const query: Record<string, string> = {};
    if (options.topic) query.topic = options.topic;
    if (options.agent_id) query.agent_id = options.agent_id;
    if (options.since) query.since = options.since;
    if (options.scope) query.scope = options.scope;
    if (options.limit !== undefined) query.limit = String(options.limit);
    return this._req('GET', '/v1/observations', { query });
  }

  /**
   * List distinct topics with observation count.
   *
   * @example
   * const { topics } = await lair.observations.topics();
   */
  async topics(): Promise<ObservationsTopicsResult> {
    return this._req('GET', '/v1/observations/topics');
  }
}

// ─── AccountNamespace ─────────────────────────────────────────────────────────

class AccountNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Get the current account profile.
   *
   * @example
   * const { account_id, tier } = await lair.account.me();
   */
  async me(): Promise<AccountMeResult> {
    return this._req('GET', '/v1/account/me');
  }

  /**
   * Get current usage statistics.
   *
   * @example
   * const { emails } = await lair.account.usage();
   * console.log(emails.daily_remaining);
   */
  async usage(): Promise<UsageResult> {
    return this._req('GET', '/v1/usage');
  }

  /**
   * Get billing information.
   *
   * @example
   * const billing = await lair.account.billing();
   */
  async billing(): Promise<BillingResult> {
    return this._req('GET', '/v1/billing');
  }
}

// ─── BudgetNamespace ──────────────────────────────────────────────────────────

/**
 * Spending controls, charge recording, and principal approval flow.
 *
 * Amounts are in **atomic USDC units** (1e-6). 1 USDC = `1_000_000`.
 */
class BudgetNamespace {
  constructor(private readonly _req: RequestFn) {}

  /**
   * Set spending caps and limit behaviour.
   *
   * @example
   * await lair.budget.set({
   *   daily: 5_000_000,    // 5 USDC/day
   *   weekly: 20_000_000,  // 20 USDC/week
   *   on_limit: 'approve', // create approval request instead of blocking
   * });
   */
  async set(options: BudgetSetOptions): Promise<BudgetResult> {
    return this._req('PUT', '/v1/budget', { body: options });
  }

  /**
   * Get current budget configuration and spend totals.
   *
   * @example
   * const { caps, on_limit } = await lair.budget.get();
   * console.log(caps.daily?.spent_usdc, '/', caps.daily?.limit_usdc, 'USDC');
   */
  async get(): Promise<BudgetResult> {
    return this._req('GET', '/v1/budget');
  }

  /**
   * Record a charge against the budget.
   * Returns immediately (HTTP 200) when within budget,
   * or creates an approval request (HTTP 202) when `on_limit: 'approve'` and the cap is exceeded.
   * Throws `AgentLairError` (HTTP 402) when `on_limit: 'reject'` and the cap is exceeded.
   *
   * @example
   * const result = await lair.budget.charge({
   *   amount: 3_000_000,        // 3 USDC
   *   category: 'inference',
   *   description: 'Claude API call',
   *   reference_id: 'job_abc',
   * });
   * if (result.approval_id) {
   *   // awaiting principal approval
   * }
   */
  async charge(options: BudgetChargeOptions): Promise<BudgetChargeResult> {
    return this._req('POST', '/v1/charge', { body: options });
  }

  /**
   * List approval requests. Optionally filter by status.
   *
   * @example
   * const { approvals } = await lair.budget.approvals('pending');
   */
  async approvals(status?: 'pending' | 'approved' | 'rejected' | 'expired'): Promise<ListApprovalsResult> {
    const query: Record<string, string> = {};
    if (status) query.status = status;
    return this._req('GET', '/v1/approvals', { query });
  }

  /**
   * Get a single approval request by ID.
   *
   * @example
   * const approval = await lair.budget.getApproval(approvalId);
   * console.log(approval.status); // 'pending' | 'approved' | 'rejected' | 'expired'
   */
  async getApproval(id: string): Promise<BudgetApproval> {
    return this._req('GET', `/v1/approvals/${encodeURIComponent(id)}`);
  }

  /**
   * Approve a pending charge request. Records the charge and debits the budget.
   *
   * @example
   * await lair.budget.approve(approvalId);
   */
  async approve(id: string): Promise<ApprovalActionResult> {
    return this._req('POST', `/v1/approvals/${encodeURIComponent(id)}/approve`);
  }

  /**
   * Reject a pending charge request. No charge is recorded.
   *
   * @example
   * await lair.budget.reject(approvalId, 'exceeds quarterly budget');
   */
  async reject(id: string, reason?: string): Promise<ApprovalActionResult> {
    return this._req('POST', `/v1/approvals/${encodeURIComponent(id)}/reject`, {
      body: reason !== undefined ? { reason } : undefined,
    });
  }
}

// ─── AgentLair (primary class) ────────────────────────────────────────────────

/**
 * AgentLair — primary SDK class.
 *
 * Accepts an API key string directly (or an options object for advanced config).
 *
 * @example Three-line onboarding
 * const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
 * const inbox = await lair.email.claim('my-agent');
 * const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
 */
export class AgentLair {
  private readonly _apiKey: string;
  private readonly _baseUrl: string;

  /** Email: claim / inbox / send / read / deleteMessage / update / outbox / addresses / webhooks */
  readonly email: EmailNamespace;
  /** Vault: put / get / list / delete */
  readonly vault: VaultNamespace;
  /** Stacks: create / list */
  readonly stacks: StacksNamespace;
  /** Calendar: createEvent / listEvents / deleteEvent / getFeed */
  readonly calendar: CalendarNamespace;
  /** Observations: write / read / topics */
  readonly observations: ObservationsNamespace;
  /** Account: me / usage / billing */
  readonly account: AccountNamespace;
  /** Budget: set / get / charge / approvals / getApproval / approve / reject */
  readonly budget: BudgetNamespace;

  /**
   * @param apiKeyOrOptions API key string (e.g. "al_live_...") or options object
   */
  constructor(apiKeyOrOptions: string | AgentLairOptions) {
    if (typeof apiKeyOrOptions === 'string') {
      this._apiKey = apiKeyOrOptions;
      this._baseUrl = DEFAULT_BASE_URL;
    } else {
      this._apiKey = apiKeyOrOptions.apiKey;
      this._baseUrl = (apiKeyOrOptions.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    }

    const req = this._request.bind(this) as RequestFn;
    this.email = new EmailNamespace(req);
    this.vault = new VaultNamespace(req);
    this.stacks = new StacksNamespace(req);
    this.calendar = new CalendarNamespace(req);
    this.observations = new ObservationsNamespace(req);
    this.account = new AccountNamespace(req);
    this.budget = new BudgetNamespace(req);
  }

  private _request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; auth?: string | null } = {},
  ): Promise<T> {
    return makeRequest<T>(this._baseUrl, this._apiKey, method, path, opts);
  }

  // ─── Static: createAccount ─────────────────────────────────────────────────

  /**
   * Create a new AgentLair account and get an API key.
   * No existing account needed. **Save the returned `api_key` immediately** — not shown again.
   *
   * @example
   * const { api_key } = await AgentLair.createAccount({ name: 'my-agent' });
   * const lair = new AgentLair(api_key);
   */
  static async createAccount(
    options: CreateAccountOptions = {},
    baseUrl = DEFAULT_BASE_URL,
  ): Promise<CreateAccountResult> {
    const url = baseUrl.replace(/\/$/, '') + '/v1/auth/keys';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await response.json() as CreateAccountResult & { error?: string; message?: string };
    if (!response.ok) {
      throw new AgentLairError(
        data.message ?? `HTTP ${response.status}`,
        response.status,
        data.error ?? 'error',
      );
    }
    return data;
  }
}

// ─── AgentLairClient (legacy — fully backward compatible) ─────────────────────

/**
 * @deprecated Use `AgentLair` instead — simpler string constructor, same namespaces.
 * `AgentLairClient` is fully retained for backward compatibility.
 */
export class AgentLairClient {
  private readonly _apiKey: string;
  private readonly _baseUrl: string;

  /** Vault: put / get / list / delete */
  readonly vault: VaultNamespace;
  /** Email: claim / inbox / send / read / outbox / addresses / webhooks */
  readonly email: EmailNamespace;
  /** Stacks: create / list */
  readonly stacks: StacksNamespace;
  /** Calendar: createEvent / listEvents / deleteEvent / getFeed */
  readonly calendar: CalendarNamespace;
  /** Observations: write / read / topics */
  readonly observations: ObservationsNamespace;
  /** Account: me / usage / billing */
  readonly account: AccountNamespace;
  /** Budget: set / get / charge / approvals / getApproval / approve / reject */
  readonly budget: BudgetNamespace;

  constructor(options: AgentLairOptions) {
    this._apiKey = options.apiKey;
    this._baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

    const req = this._request.bind(this) as RequestFn;
    this.vault = new VaultNamespace(req);
    this.email = new EmailNamespace(req);
    this.stacks = new StacksNamespace(req);
    this.calendar = new CalendarNamespace(req);
    this.observations = new ObservationsNamespace(req);
    this.account = new AccountNamespace(req);
    this.budget = new BudgetNamespace(req);
  }

  private _request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; auth?: string | null } = {},
  ): Promise<T> {
    return makeRequest<T>(this._baseUrl, this._apiKey, method, path, opts);
  }

  /** @deprecated Prefer `AgentLair.createAccount()` */
  static async createAccount(
    options: CreateAccountOptions = {},
    baseUrl = DEFAULT_BASE_URL,
  ): Promise<CreateAccountResult> {
    return AgentLair.createAccount(options, baseUrl);
  }

  // ─── Legacy flat methods (backward compatible) ────────────────────────────

  /** @deprecated Use `client.email.claim(address)` */
  async claimAddress(options: ClaimAddressOptions): Promise<ClaimAddressResult> {
    return this.email.claim(options.address, { public_key: options.public_key });
  }

  /** @deprecated Use `client.email.send(options)` */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.email.send(options);
  }

  /** @deprecated Use `client.email.inbox(address, options)` */
  async getInbox(options: GetInboxOptions): Promise<GetInboxResult> {
    return this.email.inbox(options.address, { limit: options.limit });
  }

  /** @deprecated Use `client.email.read(messageId, address)` */
  async readMessage(options: ReadMessageOptions): Promise<FullMessage> {
    return this.email.read(options.messageId, options.address);
  }
}
