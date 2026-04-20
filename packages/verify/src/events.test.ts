/**
 * @agentlair/verify — Behavioral Event Reporting Tests
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { reportEvent, reportBatch, createEventBuffer } from './events.js';
import type { BehavioralEvent, EventSubmissionResponse } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_AAT = 'test.aat.token';
const EVENTS_URL = 'https://agentlair.dev/v1/events';

function makeEvent(overrides: Partial<BehavioralEvent> = {}): BehavioralEvent {
  return {
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    category: 'tool',
    action: 'tool.invoke',
    result: 'success',
    ...overrides,
  };
}

function makeSuccessResponse(accepted = 1): EventSubmissionResponse {
  return {
    accepted,
    rejected: 0,
    rate_limit: {
      remaining: 999,
      reset_at: new Date(Date.now() + 3600_000).toISOString(),
    },
  };
}

let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ─── reportEvent ──────────────────────────────────────────────────────────────

describe('reportEvent', () => {
  test('sends a single event as a batch of 1', async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const event = makeEvent({ category: 'resource', action: 'resource.read', result: 'success' });
    const result = await reportEvent(event, { aat: TEST_AAT });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    const body = capturedBody as { events: BehavioralEvent[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event_id).toBe(event.event_id);
    expect(body.events[0].category).toBe('resource');
  });

  test('sends Authorization header with Bearer token', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (input, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await reportEvent(makeEvent(), { aat: TEST_AAT });

    const headers = capturedHeaders as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TEST_AAT}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('sends to correct URL', async () => {
    let capturedUrl: string = '';
    globalThis.fetch = mock(async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await reportEvent(makeEvent(), { aat: TEST_AAT });
    expect(capturedUrl).toBe(EVENTS_URL);
  });

  test('uses custom baseUrl', async () => {
    let capturedUrl: string = '';
    globalThis.fetch = mock(async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await reportEvent(makeEvent(), { aat: TEST_AAT, baseUrl: 'https://staging.agentlair.dev' });
    expect(capturedUrl).toBe('https://staging.agentlair.dev/v1/events');
  });

  test('throws on non-retryable HTTP error', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await expect(reportEvent(makeEvent(), { aat: TEST_AAT })).rejects.toThrow('401');
  });
});

// ─── reportBatch ──────────────────────────────────────────────────────────────

describe('reportBatch', () => {
  test('sends multiple events', async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeSuccessResponse(3)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const events = [makeEvent(), makeEvent(), makeEvent()];
    const result = await reportBatch(events, { aat: TEST_AAT });

    expect(result.accepted).toBe(3);
    const body = capturedBody as { events: BehavioralEvent[] };
    expect(body.events).toHaveLength(3);
  });

  test('includes sdk_version in request body', async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await reportBatch([makeEvent()], { aat: TEST_AAT });

    const body = capturedBody as { sdk_version: string };
    expect(body.sdk_version).toBeTruthy();
  });

  test('includes session_id when provided', async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await reportBatch([makeEvent()], { aat: TEST_AAT, sessionId: 'sess_abc123' });

    const body = capturedBody as { session_id: string };
    expect(body.session_id).toBe('sess_abc123');
  });

  test('returns empty success for empty events array', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Should not be called');
    }) as typeof globalThis.fetch;

    const result = await reportBatch([], { aat: TEST_AAT });
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(0);
  });

  test('throws when batch exceeds 100 events', async () => {
    const events = Array.from({ length: 101 }, () => makeEvent());
    await expect(reportBatch(events, { aat: TEST_AAT })).rejects.toThrow('100');
  });

  test('retries on 429 with Retry-After header', async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '0' }, // 0 seconds for test speed
        });
      }
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const result = await reportBatch([makeEvent()], { aat: TEST_AAT, maxRetries: 2 });
    expect(result.accepted).toBe(1);
    expect(callCount).toBe(2); // 1 fail + 1 success
  });

  test('throws after exhausting all retries on 429', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }) as typeof globalThis.fetch;

    await expect(
      reportBatch([makeEvent()], { aat: TEST_AAT, maxRetries: 2 })
    ).rejects.toThrow('retries exhausted');
  });

  test('validates all EventCategory values are accepted in schema', async () => {
    const categories: Array<BehavioralEvent['category']> = [
      'tool', 'resource', 'auth', 'session', 'escalation', 'delegation', 'error'
    ];

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    for (const category of categories) {
      await expect(
        reportBatch([makeEvent({ category })], { aat: TEST_AAT })
      ).resolves.toBeDefined();
    }
  });
});

// ─── createEventBuffer ────────────────────────────────────────────────────────

describe('createEventBuffer', () => {
  test('add() accumulates events and flushes at flushAt threshold', async () => {
    let flushCallCount = 0;
    let lastBatchSize = 0;

    globalThis.fetch = mock(async (input, init) => {
      flushCallCount++;
      const body = JSON.parse(init?.body as string) as { events: BehavioralEvent[] };
      lastBatchSize = body.events.length;
      return new Response(JSON.stringify(makeSuccessResponse(body.events.length)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const buffer = createEventBuffer({
      aat: TEST_AAT,
      flushAt: 3,
      flushInterval: 60_000, // long interval so it doesn't fire
    });

    await buffer.add(makeEvent());
    await buffer.add(makeEvent());
    expect(flushCallCount).toBe(0); // not flushed yet

    await buffer.add(makeEvent()); // triggers flush at 3
    expect(flushCallCount).toBe(1);
    expect(lastBatchSize).toBe(3);

    await buffer.destroy();
  });

  test('flush() sends all buffered events', async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      const body = JSON.parse(init?.body as string) as { events: BehavioralEvent[] };
      return new Response(JSON.stringify(makeSuccessResponse(body.events.length)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const buffer = createEventBuffer({
      aat: TEST_AAT,
      flushAt: 100,
      flushInterval: 60_000,
    });

    await buffer.add(makeEvent());
    await buffer.add(makeEvent());

    const result = await buffer.flush();
    expect(result?.accepted).toBe(2);

    const body = capturedBody as { events: BehavioralEvent[] };
    expect(body.events).toHaveLength(2);

    await buffer.destroy();
  });

  test('flush() returns null when buffer is empty', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('should not be called');
    }) as typeof globalThis.fetch;

    const buffer = createEventBuffer({ aat: TEST_AAT, flushInterval: 60_000 });
    const result = await buffer.flush();
    expect(result).toBeNull();
    await buffer.destroy();
  });

  test('destroy() flushes remaining events', async () => {
    let flushCallCount = 0;
    globalThis.fetch = mock(async () => {
      flushCallCount++;
      return new Response(JSON.stringify(makeSuccessResponse(1)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const buffer = createEventBuffer({
      aat: TEST_AAT,
      flushAt: 100,
      flushInterval: 60_000,
    });

    await buffer.add(makeEvent());
    expect(flushCallCount).toBe(0);

    await buffer.destroy();
    expect(flushCallCount).toBe(1); // flushed on destroy
  });

  test('add() throws after destroy()', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(makeSuccessResponse(0)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const buffer = createEventBuffer({ aat: TEST_AAT, flushInterval: 60_000 });
    await buffer.destroy();

    await expect(buffer.add(makeEvent())).rejects.toThrow('destroyed');
  });

  test('calls onFlushError when flush fails', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    let errorCaught: Error | null = null;
    const buffer = createEventBuffer({
      aat: TEST_AAT,
      flushAt: 2,
      flushInterval: 60_000,
      onFlushError: (err) => { errorCaught = err; },
    });

    await buffer.add(makeEvent());
    await buffer.add(makeEvent()); // triggers flush which fails

    // Give time for async error handler to run
    await new Promise(r => setTimeout(r, 10));

    expect(errorCaught).not.toBeNull();
    expect(errorCaught?.message).toContain('500');

    // Clean up without triggering another error
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(makeSuccessResponse(0)), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    await buffer.destroy();
  });
});
