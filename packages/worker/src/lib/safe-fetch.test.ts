/**
 * safe-fetch — runtime self-host guard tests.
 *
 * Pinning the host-matcher and the override paths is the whole point: the
 * production failure mode (522 from CF Workers self-fetch) is invisible
 * in bun tests, so this module's *correctness* — not just type-checked
 * presence — is what protects future deploys.
 *
 * Run: bun test src/lib/safe-fetch.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  SELF_HOSTS,
  SelfFetchError,
  isSelfHost,
  matchHost,
  safeFetch,
  urlHost,
} from './safe-fetch.js';

describe('matchHost', () => {
  test('exact host matches', () => {
    expect(matchHost('agentlair.dev', 'agentlair.dev')).toBe(true);
  });

  test('exact host does not match unrelated', () => {
    expect(matchHost('api.resend.com', 'agentlair.dev')).toBe(false);
  });

  test('*.foo.com matches single-label subdomain', () => {
    expect(matchHost('api.agentlair.dev', '*.agentlair.dev')).toBe(true);
  });

  test('*.foo.com matches multi-label subdomain', () => {
    expect(matchHost('a.b.agentlair.dev', '*.agentlair.dev')).toBe(true);
  });

  test('*.foo.com does NOT match the bare host (no subdomain)', () => {
    // *. requires at least one subdomain label. agentlair.dev alone is
    // matched by the exact entry, not the wildcard.
    expect(matchHost('agentlair.dev', '*.agentlair.dev')).toBe(false);
  });

  test('foo.*.bar.com matches with one middle label', () => {
    expect(matchHost('agentlair-api.dev42.workers.dev', 'agentlair-api.*.workers.dev')).toBe(true);
  });

  test('foo.*.bar.com does NOT match with zero middle labels', () => {
    expect(matchHost('agentlair-api.workers.dev', 'agentlair-api.*.workers.dev')).toBe(false);
  });

  test('foo.*.bar.com does NOT match with two middle labels', () => {
    expect(matchHost('agentlair-api.a.b.workers.dev', 'agentlair-api.*.workers.dev')).toBe(false);
  });

  test('different label counts never match a no-wildcard pattern', () => {
    expect(matchHost('a.b.foo.com', 'b.foo.com')).toBe(false);
    expect(matchHost('foo.com', 'sub.foo.com')).toBe(false);
  });
});

describe('isSelfHost (default SELF_HOSTS)', () => {
  test('exact production domain', () => {
    expect(isSelfHost('agentlair.dev')).toBe(true);
  });

  test('www subdomain (covered by *.agentlair.dev wildcard)', () => {
    expect(isSelfHost('www.agentlair.dev')).toBe(true);
  });

  test('api.agentlair.dev (covered by *.agentlair.dev)', () => {
    expect(isSelfHost('api.agentlair.dev')).toBe(true);
  });

  test('bare workers.dev for THIS worker', () => {
    expect(isSelfHost('agentlair-api.workers.dev')).toBe(true);
  });

  test('account-subdomain workers.dev for THIS worker', () => {
    expect(isSelfHost('agentlair-api.account42.workers.dev')).toBe(true);
  });

  test('another worker on workers.dev does NOT match', () => {
    // The wildcard is `agentlair-api.*.workers.dev`, not `*.workers.dev`.
    // Other CF customers must NOT be flagged as our self-host.
    expect(isSelfHost('foo-api.account.workers.dev')).toBe(false);
  });

  test('unrelated public host', () => {
    expect(isSelfHost('api.resend.com')).toBe(false);
    expect(isSelfHost('api.openai.com')).toBe(false);
    expect(isSelfHost('example.com')).toBe(false);
  });

  test('case insensitivity', () => {
    expect(isSelfHost('AGENTLAIR.DEV')).toBe(true);
    expect(isSelfHost('AgentLair.Dev')).toBe(true);
  });

  test('host with port stripped', () => {
    expect(isSelfHost('agentlair.dev:443')).toBe(true);
  });

  test('IPv6 bracketed loopback (not a self-host, but must not crash)', () => {
    expect(isSelfHost('[::1]')).toBe(false);
    expect(isSelfHost('[::1]:8080')).toBe(false);
  });

  test('empty string', () => {
    expect(isSelfHost('')).toBe(false);
  });

  test('custom pattern list overrides default', () => {
    expect(isSelfHost('foo.example', ['foo.example'])).toBe(true);
    expect(isSelfHost('agentlair.dev', ['foo.example'])).toBe(false);
  });
});

describe('urlHost', () => {
  test('parses https URL', () => {
    expect(urlHost('https://agentlair.dev/foo')).toBe('agentlair.dev');
  });

  test('parses http URL with port', () => {
    expect(urlHost('http://example.com:8080/')).toBe('example.com');
  });

  test('returns "" on garbage', () => {
    expect(urlHost('not a url')).toBe('');
    expect(urlHost('')).toBe('');
  });
});

describe('SELF_HOSTS list', () => {
  test('contains the production host', () => {
    expect(SELF_HOSTS).toContain('agentlair.dev');
  });

  test('contains wildcard subdomain entry', () => {
    expect(SELF_HOSTS).toContain('*.agentlair.dev');
  });

  test('contains workers.dev exact + wildcard entries for THIS worker only', () => {
    expect(SELF_HOSTS).toContain('agentlair-api.workers.dev');
    expect(SELF_HOSTS).toContain('agentlair-api.*.workers.dev');
    // Sanity: no overly-broad *.workers.dev — that would catch every CF customer.
    expect(SELF_HOSTS).not.toContain('*.workers.dev');
  });
});

describe('safeFetch — blocks self-host', () => {
  test('throws SelfFetchError on production domain', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://agentlair.dev/.well-known/agent.json');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
    expect((thrown as SelfFetchError).host).toBe('agentlair.dev');
  });

  test('throws on wildcard subdomain', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://api.agentlair.dev/v1/foo');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });

  test('throws on bare workers.dev', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://agentlair-api.workers.dev/v1/foo');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });

  test('throws on workers.dev with account subdomain', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://agentlair-api.acct42.workers.dev/v1/foo');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });

  test('accepts a URL object', async () => {
    let thrown: unknown;
    try {
      await safeFetch(new URL('https://agentlair.dev/foo'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });

  test('accepts a Request object', async () => {
    let thrown: unknown;
    try {
      await safeFetch(new Request('https://agentlair.dev/foo'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });
});

describe('safeFetch — allows public host', () => {
  test('public host passes through to fetchImpl', async () => {
    let captured: { url: RequestInfo; init: RequestInit | undefined } | null = null;
    const stub = (async (url: RequestInfo, init?: RequestInit) => {
      captured = { url, init };
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await safeFetch('https://api.resend.com/emails', { method: 'POST' }, stub);
    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe('https://api.resend.com/emails');
    expect((captured!.init as RequestInit | undefined)?.method).toBe('POST');
  });

  test('garbage URL is forwarded — fetch (not safeFetch) gets to reject it', async () => {
    // We do NOT enforce URL validity; that's fetch's job. We only veto
    // self-host calls. A malformed input passes through (and fetch will
    // throw its own error).
    let called = false;
    const stub = (async () => {
      called = true;
      return new Response('ok');
    }) as unknown as typeof fetch;

    await safeFetch('not a url', undefined, stub);
    expect(called).toBe(true);
  });
});

describe('safeFetch — allowSelfFetch override', () => {
  test('override bypasses with sufficient reason', async () => {
    let called = false;
    const stub = (async () => {
      called = true;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await safeFetch(
      'https://agentlair.dev/health',
      { allowSelfFetch: true, allowSelfFetchReason: 'health check from cron' },
      stub,
    );
    expect(res.status).toBe(200);
    expect(called).toBe(true);
  });

  test('override without reason still throws', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://agentlair.dev/health', { allowSelfFetch: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
    expect((thrown as SelfFetchError).message).toContain('allowSelfFetchReason');
  });

  test('override with short reason (<8 chars) still throws', async () => {
    let thrown: unknown;
    try {
      await safeFetch('https://agentlair.dev/health', {
        allowSelfFetch: true,
        allowSelfFetchReason: 'tiny',
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SelfFetchError);
  });

  test('override-related fields are stripped before reaching fetch', async () => {
    let capturedInit: RequestInit | undefined;
    const stub = (async (_url: RequestInfo, init?: RequestInit) => {
      capturedInit = init;
      return new Response('ok');
    }) as unknown as typeof fetch;

    await safeFetch(
      'https://agentlair.dev/health',
      {
        method: 'GET',
        allowSelfFetch: true,
        allowSelfFetchReason: 'cron health check',
      } as any,
      stub,
    );

    expect(capturedInit).toBeDefined();
    expect((capturedInit as RequestInit).method).toBe('GET');
    expect((capturedInit as Record<string, unknown>).allowSelfFetch).toBeUndefined();
    expect((capturedInit as Record<string, unknown>).allowSelfFetchReason).toBeUndefined();
  });
});

describe('SelfFetchError', () => {
  test('exposes url and host', () => {
    const e = new SelfFetchError('https://agentlair.dev/foo', 'agentlair.dev');
    expect(e.url).toBe('https://agentlair.dev/foo');
    expect(e.host).toBe('agentlair.dev');
    expect(e.name).toBe('SelfFetchError');
    expect(e.message).toContain('522');
  });

  test('is catchable as Error', () => {
    try {
      throw new SelfFetchError('https://a/b', 'a');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(SelfFetchError);
    }
  });
});
