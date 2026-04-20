/**
 * @agentlair/verify — JWKS Cache
 *
 * Thin wrapper around jose's createRemoteJWKSet that keeps one cached
 * JWKS fetcher per (url, cacheTtl) combination, so the caller doesn't
 * create a fresh fetcher on every request.
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

const DEFAULT_JWKS_URL = 'https://agentlair.dev/.well-known/jwks.json';
const DEFAULT_CACHE_TTL = 300_000; // 5 minutes

interface CacheEntry {
  getKey: JWTVerifyGetKey;
  cacheTtl: number;
}

// Module-level cache: keyed by JWKS URL
const cache = new Map<string, CacheEntry>();

/**
 * Returns a cached JWKS key resolver for the given URL and TTL.
 *
 * jose's `createRemoteJWKSet` already handles key caching and rotation
 * internally — we just avoid creating a new instance per-request.
 */
export function getKeyResolver(
  jwksUrl: string = DEFAULT_JWKS_URL,
  cacheTtl: number = DEFAULT_CACHE_TTL,
): JWTVerifyGetKey {
  const existing = cache.get(jwksUrl);

  // Re-use existing resolver if URL matches and TTL hasn't changed
  if (existing && existing.cacheTtl === cacheTtl) {
    return existing.getKey;
  }

  const getKey = createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: cacheTtl,
  });

  cache.set(jwksUrl, { getKey, cacheTtl });
  return getKey;
}

/**
 * Clear the module-level JWKS cache.
 * Useful in tests or when forcing a key refresh.
 */
export function clearJWKSCache(): void {
  cache.clear();
}

export { DEFAULT_JWKS_URL, DEFAULT_CACHE_TTL };
