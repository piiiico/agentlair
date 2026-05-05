import { describe, expect, test } from 'bun:test';
import { agentLairDidFor, didWebToUrl, checkController } from './popa-controller.js';

describe('agentLairDidFor', () => {
  test('builds the canonical agentlair DID', () => {
    expect(agentLairDidFor('acc_abc123')).toBe('did:web:agentlair.dev:agents:acc_abc123');
  });
});

describe('didWebToUrl', () => {
  test('host-only DID resolves to /.well-known/did.json', () => {
    expect(didWebToUrl('did:web:agentlair.dev')).toBe('https://agentlair.dev/.well-known/did.json');
  });

  test('multi-segment path DID resolves to nested did.json', () => {
    expect(didWebToUrl('did:web:agentlair.dev:agents:acc_abc')).toBe(
      'https://agentlair.dev/agents/acc_abc/did.json',
    );
  });

  test('two-segment path resolves correctly', () => {
    expect(didWebToUrl('did:web:agentlair.dev:pico')).toBe('https://agentlair.dev/pico/did.json');
  });

  test('rejects non did:web', () => {
    expect(didWebToUrl('did:key:zABC')).toBeNull();
  });

  test('rejects empty path segments', () => {
    expect(didWebToUrl('did:web:agentlair.dev::pico')).toBeNull();
  });

  test('rejects slash inside a path segment (origin-escape guard)', () => {
    // A crafted DID must not be able to escape the host's namespace
    expect(didWebToUrl('did:web:agentlair.dev:foo%2F..%2Fbar')).not.toBe(
      'https://agentlair.dev/bar/did.json',
    );
  });
});

describe('checkController', () => {
  test('self-issued AgentLair DID short-circuits without fetch', async () => {
    const fetchSpy: typeof fetch = async () => {
      throw new Error('should not have been called');
    };
    const r = await checkController(
      'did:web:agentlair.dev:agents:acc_self',
      'acc_self',
      fetchSpy,
    );
    expect(r.ok).toBe(true);
  });

  test('did:key is rejected as unsupported', async () => {
    const r = await checkController(
      'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      'acc_x',
      // @ts-expect-error fetch never called
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported_did');
  });

  test('did.json with matching controller in verificationMethod is accepted', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'did:web:example.com:bot',
          verificationMethod: [
            {
              id: 'did:web:example.com:bot#k1',
              controller: 'did:web:agentlair.dev:agents:acc_owner',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/did+json' } },
      );
    const r = await checkController('did:web:example.com:bot', 'acc_owner', fakeFetch);
    expect(r.ok).toBe(true);
  });

  test('did.json without matching controller is rejected', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'did:web:example.com:bot',
          verificationMethod: [
            { id: 'did:web:example.com:bot#k1', controller: 'did:web:somebody.else' },
          ],
        }),
        { status: 200 },
      );
    const r = await checkController('did:web:example.com:bot', 'acc_owner', fakeFetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_controller');
  });

  test('did.json whose id does not match the requested DID is rejected', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'did:web:somebody.else',
          verificationMethod: [
            { id: 'did:web:somebody.else#k1', controller: 'did:web:agentlair.dev:agents:acc_owner' },
          ],
        }),
        { status: 200 },
      );
    const r = await checkController('did:web:example.com:bot', 'acc_owner', fakeFetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unresolvable');
      expect(r.detail).toBe('doc_id_mismatch');
    }
  });

  test('non-200 response → unresolvable', async () => {
    const fakeFetch: typeof fetch = async () => new Response('Not Found', { status: 404 });
    const r = await checkController('did:web:example.com:bot', 'acc_owner', fakeFetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unresolvable');
  });
});
