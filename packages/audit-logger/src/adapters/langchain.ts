// ─── LangChain Adapter ───────────────────────────────────────────────────────
// Provides a LangChain BaseCallbackHandler subclass that forwards tool calls
// and LLM events to @agentlair/audit-logger.
//
// Usage (LangChain.js):
//   import { AuditLoggerCallbackHandler } from '@agentlair/audit-logger/langchain';
//   const handler = new AuditLoggerCallbackHandler({ agentName: 'my-agent' });
//   const chain = new AgentExecutor({ ..., callbacks: [handler] });
//
// No langchain dependency required at runtime — uses duck-typing interface.

import type { AuditLoggerOptions } from '../types.js';
import { AuditLogger } from '../logger.js';

/** Minimal interface we need from LangChain's BaseCallbackHandler */
interface LangChainCallbackHandlerInterface {
  handleToolStart?: (tool: Record<string, unknown>, input: string, runId: string) => void | Promise<void>;
  handleToolEnd?: (output: string, runId: string) => void | Promise<void>;
  handleToolError?: (err: Error, runId: string) => void | Promise<void>;
  handleLLMStart?: (llm: Record<string, unknown>, prompts: string[], runId: string) => void | Promise<void>;
  handleLLMEnd?: (output: Record<string, unknown>, runId: string) => void | Promise<void>;
  handleChainStart?: (chain: Record<string, unknown>, inputs: Record<string, unknown>, runId: string) => void | Promise<void>;
  handleChainEnd?: (outputs: Record<string, unknown>, runId: string) => void | Promise<void>;
}

export interface AuditLoggerCallbackHandlerOptions extends AuditLoggerOptions {
  /** Name to use as the 'agent' field in audit entries */
  agentName?: string;
}

/** Pending tool call — matched by runId */
interface PendingTool {
  name: string;
  input: string;
  startedAt: string;
}

/**
 * LangChain callback handler that logs all tool calls and LLM invocations.
 *
 * Compatible with LangChain.js >=0.1.0 (callback interface).
 * Import langchain separately — this adapter uses duck-typing, no hard dep.
 */
export class AuditLoggerCallbackHandler implements LangChainCallbackHandlerInterface {
  private readonly logger: AuditLogger;
  private readonly agentName: string;
  private readonly pendingTools = new Map<string, PendingTool>();

  constructor(options: AuditLoggerCallbackHandlerOptions = {}) {
    const { agentName, ...loggerOptions } = options;
    this.logger = new AuditLogger(loggerOptions);
    this.agentName = agentName ?? 'langchain-agent';
  }

  async handleToolStart(tool: Record<string, unknown>, input: string, runId: string): Promise<void> {
    const toolName = (tool.name as string | undefined) ?? 'unknown_tool';
    this.pendingTools.set(runId, { name: toolName, input, startedAt: new Date().toISOString() });
    await this.logger.log({
      agent: this.agentName,
      action: 'tool_start',
      tool: toolName,
      input,
    });
  }

  async handleToolEnd(output: string, runId: string): Promise<void> {
    const pending = this.pendingTools.get(runId);
    this.pendingTools.delete(runId);
    await this.logger.log({
      agent: this.agentName,
      action: 'tool_end',
      tool: pending?.name ?? 'unknown_tool',
      input: pending?.input,
      output,
      metadata: pending ? { startedAt: pending.startedAt } : undefined,
    });
  }

  async handleToolError(err: Error, runId: string): Promise<void> {
    const pending = this.pendingTools.get(runId);
    this.pendingTools.delete(runId);
    await this.logger.log({
      agent: this.agentName,
      action: 'tool_error',
      tool: pending?.name ?? 'unknown_tool',
      output: err.message,
      metadata: { error: true, errorClass: err.constructor.name },
    });
  }

  async handleLLMStart(_llm: Record<string, unknown>, prompts: string[], _runId: string): Promise<void> {
    await this.logger.log({
      agent: this.agentName,
      action: 'llm_start',
      input: prompts[0],
      metadata: { promptCount: prompts.length },
    });
  }

  async handleLLMEnd(output: Record<string, unknown>, _runId: string): Promise<void> {
    await this.logger.log({
      agent: this.agentName,
      action: 'llm_end',
      output,
    });
  }

  async handleChainStart(chain: Record<string, unknown>, inputs: Record<string, unknown>, _runId: string): Promise<void> {
    await this.logger.log({
      agent: this.agentName,
      action: 'chain_start',
      metadata: { chainType: chain.id, inputs },
    });
  }

  async handleChainEnd(outputs: Record<string, unknown>, _runId: string): Promise<void> {
    await this.logger.log({
      agent: this.agentName,
      action: 'chain_end',
      output: outputs,
    });
  }
}
