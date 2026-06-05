import { describe, test, expect } from 'bun:test';
import { ROBOTS_TXT } from './robots-txt.js';

describe('ROBOTS_TXT', () => {
  test('contains User-agent: * directive', () => {
    expect(ROBOTS_TXT).toMatch(/^User-agent: \*/m);
  });

  test('contains Allow: / directive', () => {
    expect(ROBOTS_TXT).toMatch(/^Allow: \//m);
  });

  test('lists the Pages-served sitemap', () => {
    expect(ROBOTS_TXT).toContain('Sitemap: https://agentlair.dev/sitemap-0.xml');
  });

  test('lists the worker-served A2A sitemap', () => {
    expect(ROBOTS_TXT).toContain('Sitemap: https://agentlair.dev/sitemap-a2a.xml');
  });

  test('contains AI-bot user-agent lines', () => {
    expect(ROBOTS_TXT).toContain('User-agent: GPTBot');
    expect(ROBOTS_TXT).toContain('User-agent: ChatGPT-User');
    expect(ROBOTS_TXT).toContain('User-agent: ClaudeBot');
    expect(ROBOTS_TXT).toContain('User-agent: anthropic-ai');
    expect(ROBOTS_TXT).toContain('User-agent: PerplexityBot');
    expect(ROBOTS_TXT).toContain('User-agent: cohere-ai');
    expect(ROBOTS_TXT).toContain('User-agent: Google-Extended');
    expect(ROBOTS_TXT).toContain('User-agent: CCBot');
  });
});
