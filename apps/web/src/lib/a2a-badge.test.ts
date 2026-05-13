import { describe, it, expect } from 'bun:test';
import {
  encodeCardUrl,
  validateCardUrl,
  buildBadgeUrl,
  buildMarkdownSnippet,
  buildHtmlSnippet,
  buildAsciidocSnippet,
} from './a2a-badge';

describe('encodeCardUrl', () => {
  it('encodes a standard URL', () => {
    const result = encodeCardUrl('https://example.com/.well-known/agent-card.json');
    expect(result).toBeTruthy();
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
    expect(result).not.toContain('=');
  });

  it('encodes URL with special path characters', () => {
    const url = 'https://example.com/path+test/sub_dir/file';
    const result = encodeCardUrl(url);
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
    expect(result).not.toContain('=');
  });

  it('encodes URL with query string', () => {
    const url = 'https://example.com/agent?version=1&format=json';
    const result = encodeCardUrl(url);
    expect(result).toBeTruthy();
    expect(result).not.toContain('=');
  });

  it('is stable on re-encode of encoded value', () => {
    const url = 'https://example.com/agent-card.json';
    const encoded = encodeCardUrl(url);
    // Re-encoding the encoded string should produce a different (longer) result
    // but the original encode should be deterministic
    expect(encodeCardUrl(url)).toBe(encoded);
  });
});

describe('validateCardUrl', () => {
  it('accepts https:// URLs', () => {
    const result = validateCardUrl('https://example.com/agent-card.json');
    expect(result.ok).toBe(true);
  });

  it('rejects http:// URLs', () => {
    const result = validateCardUrl('http://example.com/agent-card.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('rejects empty string', () => {
    const result = validateCardUrl('');
    expect(result.ok).toBe(false);
  });

  it('rejects javascript: protocol', () => {
    const result = validateCardUrl('javascript:alert(1)');
    expect(result.ok).toBe(false);
  });

  it('rejects data: protocol', () => {
    const result = validateCardUrl('data:text/html,<h1>hi</h1>');
    expect(result.ok).toBe(false);
  });

  it('rejects file:// protocol', () => {
    const result = validateCardUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects malformed URL with no protocol', () => {
    const result = validateCardUrl('example.com/agent-card.json');
    expect(result.ok).toBe(false);
  });
});

describe('buildBadgeUrl', () => {
  const encoded = 'dGVzdA';

  it('omits style param when style is flat', () => {
    const url = buildBadgeUrl({ encoded, style: 'flat' });
    expect(url).not.toContain('style=');
  });

  it('includes style param when not flat', () => {
    const url = buildBadgeUrl({ encoded, style: 'flat-square' });
    expect(url).toContain('style=flat-square');
  });

  it('includes label when provided', () => {
    const url = buildBadgeUrl({ encoded, style: 'flat', label: 'A2A Audit' });
    expect(url).toContain('label=A2A+Audit');
  });
});

describe('snippet builders', () => {
  const badgeUrl = 'https://agentlair.dev/badge/a2a/abc123';
  const cardUrl = 'https://example.com/agent-card.json';

  it('markdown snippet includes both URLs', () => {
    const md = buildMarkdownSnippet({ badgeUrl, cardUrl });
    expect(md).toContain(badgeUrl);
    expect(md).toContain(cardUrl);
  });

  it('markdown snippet uses correct syntax', () => {
    const md = buildMarkdownSnippet({ badgeUrl, cardUrl });
    expect(md).toMatch(/^\[!\[.*\]\(.*\)\]\(.*\)$/);
  });

  it('html snippet includes both URLs', () => {
    const html = buildHtmlSnippet({ badgeUrl, cardUrl });
    expect(html).toContain(badgeUrl);
    expect(html).toContain(cardUrl);
  });

  it('html snippet uses correct syntax', () => {
    const html = buildHtmlSnippet({ badgeUrl, cardUrl });
    expect(html).toContain('<a href=');
    expect(html).toContain('<img src=');
  });

  it('asciidoc snippet includes both URLs', () => {
    const adoc = buildAsciidocSnippet({ badgeUrl, cardUrl });
    expect(adoc).toContain(badgeUrl);
    expect(adoc).toContain(cardUrl);
  });

  it('asciidoc snippet uses correct syntax', () => {
    const adoc = buildAsciidocSnippet({ badgeUrl, cardUrl });
    expect(adoc).toMatch(/^image:/);
    expect(adoc).toContain('link=');
  });
});
