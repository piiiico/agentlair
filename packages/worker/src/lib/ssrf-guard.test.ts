import { describe, it, expect } from 'bun:test';
import { isBlockedHost } from './ssrf-guard.js';

describe('isBlockedHost', () => {
  // ── IPv4 private ranges ──────────────────────────────────────────────────
  it('blocks 0.0.0.0 (0.0.0.0/8 unspecified)', () => {
    expect(isBlockedHost('0.0.0.0')).toBe(true);
  });

  it('blocks 0.255.255.255 (0.0.0.0/8 boundary)', () => {
    expect(isBlockedHost('0.255.255.255')).toBe(true);
  });

  it('blocks 127.0.0.1 (loopback)', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
  });

  it('blocks 127.255.255.255 (loopback /8)', () => {
    expect(isBlockedHost('127.255.255.255')).toBe(true);
  });

  it('blocks 10.0.0.1 (RFC1918 /8)', () => {
    expect(isBlockedHost('10.0.0.1')).toBe(true);
  });

  it('blocks 10.255.255.255 (RFC1918 /8 boundary)', () => {
    expect(isBlockedHost('10.255.255.255')).toBe(true);
  });

  it('blocks 172.16.0.1 (RFC1918 /12)', () => {
    expect(isBlockedHost('172.16.0.1')).toBe(true);
  });

  it('blocks 172.31.255.255 (RFC1918 /12 boundary)', () => {
    expect(isBlockedHost('172.31.255.255')).toBe(true);
  });

  it('blocks 192.168.1.1 (RFC1918 /16)', () => {
    expect(isBlockedHost('192.168.1.1')).toBe(true);
  });

  it('blocks 169.254.169.254 (link-local / CF metadata)', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
  });

  it('blocks 169.254.0.1 (link-local start)', () => {
    expect(isBlockedHost('169.254.0.1')).toBe(true);
  });

  // ── IPv6 loopback and private ranges ─────────────────────────────────────
  it('blocks ::1 (IPv6 loopback)', () => {
    expect(isBlockedHost('::1')).toBe(true);
  });

  it('blocks [::1] (IPv6 loopback with brackets)', () => {
    expect(isBlockedHost('[::1]')).toBe(true);
  });

  it('blocks fe80::1 (IPv6 link-local)', () => {
    expect(isBlockedHost('fe80::1')).toBe(true);
  });

  it('blocks fc00::1 (IPv6 ULA)', () => {
    expect(isBlockedHost('fc00::1')).toBe(true);
  });

  it('blocks fd00::1 (IPv6 ULA fc00::/7 range)', () => {
    expect(isBlockedHost('fd00::1')).toBe(true);
  });

  // ── Hostname DNS name checks ──────────────────────────────────────────────
  it('blocks localhost', () => {
    expect(isBlockedHost('localhost')).toBe(true);
  });

  it('blocks *.local hostnames', () => {
    expect(isBlockedHost('myservice.local')).toBe(true);
  });

  it('blocks *.internal hostnames', () => {
    expect(isBlockedHost('api.internal')).toBe(true);
  });

  // ── Happy path: public hosts must be allowed ──────────────────────────────
  it('allows 8.8.8.8 (public DNS)', () => {
    expect(isBlockedHost('8.8.8.8')).toBe(false);
  });

  it('allows api.agentlair.dev (public hostname)', () => {
    expect(isBlockedHost('api.agentlair.dev')).toBe(false);
  });

  it('allows 2001:4860:4860::8888 (Google public IPv6 DNS)', () => {
    expect(isBlockedHost('2001:4860:4860::8888')).toBe(false);
  });

  it('does NOT block 172.15.255.255 (just below /12 range)', () => {
    expect(isBlockedHost('172.15.255.255')).toBe(false);
  });

  it('does NOT block 172.32.0.0 (just above /12 range)', () => {
    expect(isBlockedHost('172.32.0.0')).toBe(false);
  });

  it('allows empty string', () => {
    expect(isBlockedHost('')).toBe(false);
  });

  // ── Port stripping ────────────────────────────────────────────────────────
  it('blocks 127.0.0.1:8080 (loopback with port)', () => {
    expect(isBlockedHost('127.0.0.1:8080')).toBe(true);
  });
});
