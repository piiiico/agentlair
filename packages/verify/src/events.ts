/**
 * @agentlair/verify — Behavioral Event Reporting
 *
 * Implements RFC-003: reportEvent(), reportBatch(), and createEventBuffer().
 */

import type {
  BehavioralEvent,
  EventSubmission,
  EventSubmissionResponse,
  ReportOptions,
  BufferOptions,
  EventBuffer,
} from './types.js';

const SDK_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'https://agentlair.dev';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_FLUSH_AT = 50;
const DEFAULT_FLUSH_INTERVAL = 10_000;

/**
 * Report a single behavioral event to AgentLair.
 *
 * @example
 * ```typescript
 * import { reportEvent } from '@agentlair/verify';
 *
 * await reportEvent(
 *   {
 *     event_id: crypto.randomUUID(),
 *     timestamp: new Date().toISOString(),
 *     category: 'tool',
 *     action: 'tool.invoke',
 *     result: 'success',
 *     metadata: { tool_name: 'read_file', file_type: 'json' },
 *   },
 *   {
 *     aat: process.env.AGENTLAIR_AAT!,
 *   }
 * );
 * ```
 */
export async function reportEvent(
  event: BehavioralEvent,
  options: ReportOptions,
): Promise<EventSubmissionResponse> {
  return reportBatch([event], options);
}

/**
 * Report up to 100 behavioral events to AgentLair in one request.
 *
 * On 429 rate limiting, respects the Retry-After header and retries
 * up to maxRetries times (default: 2).
 *
 * @throws {Error} if all retries are exhausted or a non-retryable error occurs
 *
 * @example
 * ```typescript
 * import { reportBatch } from '@agentlair/verify';
 *
 * await reportBatch(events, { aat: process.env.AGENTLAIR_AAT! });
 * ```
 */
export async function reportBatch(
  events: BehavioralEvent[],
  options: ReportOptions,
): Promise<EventSubmissionResponse> {
  const {
    aat,
    baseUrl = DEFAULT_BASE_URL,
    sessionId,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  if (events.length === 0) {
    return { accepted: 0, rejected: 0, rate_limit: { remaining: 0, reset_at: new Date().toISOString() } };
  }

  if (events.length > 100) {
    throw new Error(`Batch size exceeds maximum: got ${events.length}, max 100`);
  }

  const body: EventSubmission = {
    events,
    sdk_version: SDK_VERSION,
    ...(sessionId ? { session_id: sessionId } : {}),
  };

  const url = `${baseUrl.replace(/\/$/, '')}/v1/events`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      if (attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter ? parseRetryAfter(retryAfter) : 1000 * (attempt + 1);
        await sleep(delayMs);
        lastError = new Error(`Rate limited (429): retried after ${delayMs}ms`);
        continue;
      } else {
        throw new Error(`Rate limited (429): all ${maxRetries} retries exhausted`);
      }
    }

    if (!response.ok) {
      let errorDetail: string;
      try {
        const errorBody = await response.json() as { error?: string };
        errorDetail = errorBody.error ?? response.statusText;
      } catch {
        errorDetail = response.statusText;
      }
      throw new Error(`AgentLair event submission failed (${response.status}): ${errorDetail}`);
    }

    return response.json() as Promise<EventSubmissionResponse>;
  }

  // Should not reach here, but TypeScript needs it
  throw lastError ?? new Error('Unknown error in reportBatch');
}

/**
 * Create a buffered event reporter that accumulates events in memory
 * and flushes them in batches.
 *
 * Useful for high-throughput agents that generate many small events.
 *
 * @example
 * ```typescript
 * import { createEventBuffer } from '@agentlair/verify';
 *
 * const buffer = createEventBuffer({
 *   aat: process.env.AGENTLAIR_AAT!,
 *   flushAt: 50,       // flush every 50 events
 *   flushInterval: 5000, // or every 5 seconds
 * });
 *
 * // Add events throughout the session
 * await buffer.add({ event_id: crypto.randomUUID(), ... });
 *
 * // At shutdown: flush remaining events and clean up
 * await buffer.destroy();
 * ```
 */
export function createEventBuffer(options: BufferOptions): EventBuffer {
  const {
    flushAt = DEFAULT_FLUSH_AT,
    flushInterval = DEFAULT_FLUSH_INTERVAL,
    onFlushError = (err: Error) => console.error('[agentlair/verify] Event buffer flush error:', err),
    ...reportOptions
  } = options;

  let buffer: BehavioralEvent[] = [];
  let destroyed = false;

  const doFlush = async (): Promise<EventSubmissionResponse | null> => {
    if (buffer.length === 0) return null;
    const batch = buffer.splice(0, 100); // take up to 100
    return reportBatch(batch, reportOptions);
  };

  // Set up interval timer
  const timer = setInterval(async () => {
    if (destroyed || buffer.length === 0) return;
    try {
      await doFlush();
    } catch (err) {
      onFlushError(err instanceof Error ? err : new Error(String(err)));
    }
  }, flushInterval);

  // Don't block Node.js/Bun from exiting
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref(): void }).unref();
  }

  return {
    async add(event: BehavioralEvent): Promise<void> {
      if (destroyed) throw new Error('EventBuffer has been destroyed');
      buffer.push(event);
      if (buffer.length >= flushAt) {
        try {
          await doFlush();
        } catch (err) {
          onFlushError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    },

    async flush(): Promise<EventSubmissionResponse | null> {
      if (destroyed) throw new Error('EventBuffer has been destroyed');
      return doFlush();
    },

    async destroy(): Promise<void> {
      destroyed = true;
      clearInterval(timer);
      // Flush any remaining events
      if (buffer.length > 0) {
        await doFlush();
      }
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRetryAfter(retryAfter: string): number {
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  // Try HTTP date format
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
  return 1000; // fallback: 1 second
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
