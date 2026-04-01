// ─── Anthropic / Claude SDK Adapter ─────────────────────────────────────────
// Middleware wrapper for Anthropic SDK message calls.
//
// Usage:
//   import Anthropic from '@anthropic-ai/sdk';
//   import { wrapAnthropicClient } from '@agentlair/audit-logger/anthropic';
//
//   const client = new Anthropic();
//   const audited = wrapAnthropicClient(client, { agentName: 'my-agent' });
//
//   // Use exactly like normal client — audit happens automatically
//   const msg = await audited.messages.create({ model: 'claude-3-5-sonnet', ... });
//
// No @anthropic-ai/sdk dependency required — uses duck-typing.

import type { AuditLoggerOptions } from '../types.js';
import { AuditLogger } from '../logger.js';

/** Minimal Anthropic message params we care about for logging */
interface AnthropicMessageParams {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  max_tokens?: number;
  system?: string;
  [key: string]: unknown;
}

/** Minimal Anthropic message response */
interface AnthropicMessage {
  id?: string;
  model?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  content?: unknown[];
  [key: string]: unknown;
}

/** Minimal Anthropic client interface */
interface AnthropicClientLike {
  messages: {
    create(params: AnthropicMessageParams): Promise<AnthropicMessage>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WrapAnthropicOptions extends AuditLoggerOptions {
  /** Name to use as the 'agent' field in audit entries */
  agentName?: string;
}

/**
 * Wraps an Anthropic client to automatically audit all messages.create() calls.
 * Returns a proxy that behaves identically to the original client.
 *
 * @example
 * const audited = wrapAnthropicClient(new Anthropic(), { agentName: 'researcher' });
 * const msg = await audited.messages.create({ model: 'claude-opus-4-5', ... });
 */
export function wrapAnthropicClient<T extends AnthropicClientLike>(
  client: T,
  options: WrapAnthropicOptions = {},
): T {
  const { agentName, ...loggerOptions } = options;
  const logger = new AuditLogger(loggerOptions);
  const name = agentName ?? 'claude-agent';

  const originalCreate = client.messages.create.bind(client.messages);

  const wrappedMessages = {
    ...client.messages,
    async create(params: AnthropicMessageParams): Promise<AnthropicMessage> {
      const startedAt = new Date().toISOString();

      // Log the request
      await logger.log({
        agent: name,
        action: 'llm_request',
        tool: 'messages.create',
        input: {
          model: params.model,
          messageCount: Array.isArray(params.messages) ? params.messages.length : 0,
          hasTools: Array.isArray(params.tools) && params.tools.length > 0,
          maxTokens: params.max_tokens,
          hasSystem: !!params.system,
          // Last user message content (truncated for privacy)
          lastMessage: Array.isArray(params.messages) && params.messages.length > 0
            ? summarize(params.messages[params.messages.length - 1]?.content)
            : undefined,
        },
        timestamp: startedAt,
      });

      let response: AnthropicMessage;
      try {
        response = await originalCreate(params);
      } catch (err) {
        // Log error
        await logger.log({
          agent: name,
          action: 'llm_error',
          tool: 'messages.create',
          output: (err as Error).message,
          metadata: { error: true, startedAt },
        });
        throw err;
      }

      // Log the response
      await logger.log({
        agent: name,
        action: 'llm_response',
        tool: 'messages.create',
        output: {
          model: response.model,
          stopReason: response.stop_reason,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          contentBlocks: Array.isArray(response.content) ? response.content.length : 0,
        },
        metadata: { startedAt, messageId: response.id },
      });

      return response;
    },
  };

  return { ...client, messages: wrappedMessages } as T;
}

/** Summarize content for safe logging (truncate long strings) */
function summarize(content: unknown): string {
  if (typeof content === 'string') {
    return content.length > 200 ? content.slice(0, 200) + '…' : content;
  }
  if (Array.isArray(content)) {
    const text = content.find((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text');
    if (text && typeof (text as Record<string, unknown>).text === 'string') {
      const t = (text as Record<string, string>).text;
      return t.length > 200 ? t.slice(0, 200) + '…' : t;
    }
  }
  return '[non-text content]';
}
