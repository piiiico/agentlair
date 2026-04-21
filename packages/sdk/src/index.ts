/**
 * @agentlair/sdk
 *
 * Official TypeScript/JavaScript SDK for AgentLair.
 * Zero dependencies. Works in Node ≥ 18, Bun, Deno, and modern browsers.
 *
 * @example Three-line onboarding
 * import { AgentLair } from '@agentlair/sdk';
 *
 * const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
 * const inbox = await lair.email.claim('my-agent');
 * const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
 *
 * @example Bootstrap: create an account
 * const { api_key } = await AgentLair.createAccount({ name: 'my-agent' });
 * const lair = new AgentLair(api_key);
 *
 * @see https://agentlair.dev/docs
 */

export { AgentLair, AgentLairClient } from './client.js';
export { AgentLairError } from './errors.js';

export type {
  // SDK config
  AgentLairOptions,
  AgentLairClientOptions,
  // Account
  CreateAccountOptions,
  CreateAccountResult,
  AccountMeResult,
  UsageResult,
  BillingResult,
  // Email
  ClaimAddressOptions,
  ClaimAddressResult,
  ListAddressesResult,
  SendEmailOptions,
  SendEmailResult,
  GetInboxOptions,
  GetInboxResult,
  InboxMessage,
  FullMessage,
  ReadMessageOptions,
  DeleteMessageResult,
  UpdateMessageOptions,
  UpdateMessageResult,
  OutboxMessage,
  OutboxResult,
  // Webhooks
  RegisterWebhookOptions,
  Webhook,
  ListWebhooksOptions,
  ListWebhooksResult,
  DeleteWebhookResult,
  // Stacks
  CreateStackOptions,
  Stack,
  ListStacksResult,
  // Calendar
  CreateCalendarEventOptions,
  CalendarEvent,
  CreateCalendarEventResult,
  ListCalendarEventsOptions,
  ListCalendarEventsResult,
  CalendarFeedResult,
  DeleteCalendarEventResult,
  // Observations
  WriteObservationOptions,
  Observation,
  ReadObservationsOptions,
  ReadObservationsResult,
  ObservationTopic,
  ObservationsTopicsResult,
  // Vault
  VaultPutOptions,
  VaultPutResult,
  VaultGetOptions,
  VaultGetResult,
  VaultKeyInfo,
  VaultListResult,
  VaultDeleteOptions,
  VaultDeleteResult,
  // Budget
  BudgetSetOptions,
  BudgetCap,
  BudgetResult,
  BudgetChargeOptions,
  BudgetExceededPeriod,
  BudgetChargeResult,
  BudgetApproval,
  ListApprovalsResult,
  ApprovalActionResult,
  // Events
  EventCategory,
  EventResult,
  EmitEventOptions,
  EventError,
  EmitEventResult,
  // Trust
  TrustDimension,
  TrustScoreResult,
  TrustBadgeStyle,
  // Errors
  AgentLairErrorBody,
} from './types.js';
