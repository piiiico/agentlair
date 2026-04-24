// ---------------------------------------------------------------------------
// @agentlair/agent-framework — Telemetry Collector
//
// Collects behavioral events from the Agent Framework runtime and forwards
// them to AgentLair in batches. Captures:
//
//   - Tool/function calls (name, duration, success/failure)
//   - A2A task lifecycle (submission, completion, delegation)
//   - MCP operations (tool discovery, resource access)
//   - Session events (start, end, error)
//
// Usage:
//   import { TelemetryCollector } from '@agentlair/agent-framework/telemetry';
//
//   const telemetry = new TelemetryCollector({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//     flushInterval: 5000,
//   });
//
//   telemetry.recordToolCall('search', { query: 'test' }, 'success', 120);
//   telemetry.recordA2ADelegation('agent-123', 'research-task');
//
//   // On shutdown:
//   await telemetry.flush();
// ---------------------------------------------------------------------------

import type { BehavioralEvent, EventCategory, EventResult } from "./types.js";
import { emitEvents } from "./trust-client.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TelemetryCollectorOptions {
  /** AgentLair API key. Required for event submission. */
  apiKey: string;
  /** AgentLair base URL. @default "https://agentlair.dev" */
  baseUrl?: string;
  /** Batch flush interval in ms. @default 5000 */
  flushInterval?: number;
  /** Maximum events to buffer before force-flush. @default 100 */
  maxBufferSize?: number;
  /** Session ID for grouping events. Auto-generated if omitted. */
  sessionId?: string;
  /** Request timeout in ms. @default 2000 */
  timeout?: number;
  /** Called when a flush fails. */
  onFlushError?: (error: Error, events: BehavioralEvent[]) => void;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * Collects behavioral events from the Agent Framework and submits them
 * to AgentLair in batches. Designed for minimal overhead — events are
 * buffered in memory and flushed periodically or when the buffer fills.
 */
export class TelemetryCollector {
  private buffer: BehavioralEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxBufferSize: number;
  private readonly sessionId: string;
  private readonly timeout: number;
  private readonly onFlushError?: (error: Error, events: BehavioralEvent[]) => void;

  constructor(options: TelemetryCollectorOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://agentlair.dev";
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.timeout = options.timeout ?? 2000;
    this.onFlushError = options.onFlushError;

    const interval = options.flushInterval ?? 5000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.flush();
      }, interval);
      // Don't hold the process open for telemetry
      if (typeof this.timer === "object" && "unref" in this.timer) {
        this.timer.unref();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Recording methods
  // -------------------------------------------------------------------------

  /** Record a tool/function call. */
  recordToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: EventResult,
    durationMs: number,
    metadata?: Record<string, string | number | boolean>,
  ): void {
    this.record({
      category: "tool",
      action: toolName,
      result,
      resource_type: "function",
      duration_ms: durationMs,
      metadata: {
        ...metadata,
        arg_count: Object.keys(args).length,
      },
      session_id: this.sessionId,
    });
  }

  /** Record an MCP tool discovery or resource access. */
  recordMCPOperation(
    operation: "tool_list" | "tool_call" | "resource_read" | "resource_list" | "prompt_get",
    target: string,
    result: EventResult,
    durationMs: number,
  ): void {
    this.record({
      category: "resource",
      action: `mcp_${operation}`,
      result,
      resource_type: "mcp",
      duration_ms: durationMs,
      metadata: { target },
      session_id: this.sessionId,
    });
  }

  /** Record an A2A task delegation event. */
  recordA2ADelegation(
    targetAgentId: string,
    taskDescription: string,
    result: EventResult = "success",
    durationMs?: number,
  ): void {
    this.record({
      category: "delegation",
      action: "a2a_delegate",
      result,
      resource_type: "a2a_task",
      duration_ms: durationMs,
      metadata: {
        target_agent: targetAgentId,
        task_desc: taskDescription.slice(0, 256),
      },
      session_id: this.sessionId,
    });
  }

  /** Record an A2A task received from another agent. */
  recordA2ATaskReceived(
    fromAgentId: string,
    taskId: string,
    result: EventResult = "success",
  ): void {
    this.record({
      category: "delegation",
      action: "a2a_task_received",
      result,
      resource_type: "a2a_task",
      metadata: {
        from_agent: fromAgentId,
        task_id: taskId,
      },
      session_id: this.sessionId,
    });
  }

  /** Record a session lifecycle event. */
  recordSession(
    action: "session_start" | "session_end" | "session_error",
    metadata?: Record<string, string | number | boolean>,
  ): void {
    this.record({
      category: "session",
      action,
      result: action === "session_error" ? "failure" : "success",
      metadata,
      session_id: this.sessionId,
    });
  }

  /** Record an auth event (token verification, scope check). */
  recordAuth(
    action: string,
    result: EventResult,
    metadata?: Record<string, string | number | boolean>,
  ): void {
    this.record({
      category: "auth",
      action,
      result,
      metadata,
      session_id: this.sessionId,
    });
  }

  /** Record a generic behavioral event. */
  record(event: BehavioralEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  // -------------------------------------------------------------------------
  // Flush
  // -------------------------------------------------------------------------

  /** Flush all buffered events to AgentLair. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    try {
      await emitEvents(events, {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        timeout: this.timeout,
      });
    } catch (err) {
      if (this.onFlushError) {
        this.onFlushError(err instanceof Error ? err : new Error(String(err)), events);
      }
      // Don't re-buffer — events are lost on failure to prevent unbounded growth
    }
  }

  /** Stop the flush timer and flush remaining events. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /** Get the current session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Get the number of buffered events. */
  get pendingCount(): number {
    return this.buffer.length;
  }
}
