/**
 * @agentlair/verify — Framework Middleware Factories
 *
 * Ready-to-use middleware for Express, Hono, and Fastify.
 * Each factory verifies the AAT from the Authorization header
 * and attaches the result to the request context.
 */

import { verifyAAT } from './verify.js';
import type { MiddlewareOptions, VerifyResult } from './types.js';

// ─── Token extraction helpers ─────────────────────────────────────────────────

function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Express middleware that verifies the AAT from the Authorization header.
 *
 * On success, attaches `req.aat` with the verified result.
 * On failure, responds with 401 Unauthorized.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createExpressMiddleware } from '@agentlair/verify';
 *
 * const app = express();
 * app.use('/api', createExpressMiddleware({ audience: 'https://my-api.example.com' }));
 *
 * app.get('/api/data', (req, res) => {
 *   console.log('Agent:', req.aat?.agentId);
 *   res.json({ ok: true });
 * });
 * ```
 */
export function createExpressMiddleware(options: MiddlewareOptions = {}) {
  return async function aatMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNext,
  ): Promise<void> {
    const authHeader = req.headers?.['authorization'];
    const token = extractBearerToken(Array.isArray(authHeader) ? authHeader[0] : authHeader);

    if (!token) {
      res.status(401).json({ error: 'Missing Authorization header (Bearer token required)' });
      return;
    }

    const result = await verifyAAT(token, options);

    if (!result.valid) {
      if (options.onError?.(result.error, req)) return;
      res.status(401).json({ error: result.error });
      return;
    }

    req.aat = result;
    next();
  };
}

// ─── Hono middleware ──────────────────────────────────────────────────────────

/**
 * Hono middleware that verifies the AAT from the Authorization header.
 *
 * On success, sets `c.set('aat', result)` and calls `next()`.
 * On failure, returns a 401 response.
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono';
 * import { createHonoMiddleware } from '@agentlair/verify';
 *
 * const app = new Hono();
 * app.use('/api/*', createHonoMiddleware({ audience: 'https://my-api.example.com' }));
 *
 * app.get('/api/data', (c) => {
 *   const aat = c.get('aat');
 *   return c.json({ agentId: aat.agentId });
 * });
 * ```
 */
export function createHonoMiddleware(options: MiddlewareOptions = {}) {
  return async function aatMiddleware(c: HonoContext, next: HonoNext): Promise<HonoResponse | undefined> {
    const token = extractBearerToken(c.req.header('authorization'));

    if (!token) {
      return c.json({ error: 'Missing Authorization header (Bearer token required)' }, 401);
    }

    const result = await verifyAAT(token, options);

    if (!result.valid) {
      if (options.onError?.(result.error, c)) return undefined;
      return c.json({ error: result.error }, 401);
    }

    c.set('aat', result);
    await next();
    return undefined;
  };
}

// ─── Fastify middleware ───────────────────────────────────────────────────────

/**
 * Fastify `preHandler` hook that verifies the AAT from the Authorization header.
 *
 * On success, sets `request.aat` with the verified result.
 * On failure, replies with 401 Unauthorized.
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createFastifyHook } from '@agentlair/verify';
 *
 * const fastify = Fastify();
 * fastify.addHook('preHandler', createFastifyHook({ audience: 'https://my-api.example.com' }));
 *
 * fastify.get('/api/data', async (request, reply) => {
 *   console.log('Agent:', request.aat?.agentId);
 *   return { ok: true };
 * });
 * ```
 */
export function createFastifyHook(options: MiddlewareOptions = {}) {
  return async function aatHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers?.['authorization'];
    const token = extractBearerToken(Array.isArray(authHeader) ? authHeader[0] : authHeader);

    if (!token) {
      await reply.status(401).send({ error: 'Missing Authorization header (Bearer token required)' });
      return;
    }

    const result = await verifyAAT(token, options);

    if (!result.valid) {
      if (options.onError?.(result.error, request)) return;
      await reply.status(401).send({ error: result.error });
      return;
    }

    request.aat = result;
  };
}

// ─── Minimal framework types ──────────────────────────────────────────────────
// Structural types — no framework imports needed. Compatible with Express 4/5,
// Hono 3/4, Fastify 4/5.

interface ExpressRequest {
  headers: Record<string, string | string[] | undefined>;
  aat?: Extract<VerifyResult, { valid: true }>;
  [key: string]: unknown;
}

interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(body: unknown): void;
}

type ExpressNext = () => void;

interface HonoContext {
  req: { header(name: string): string | undefined };
  set(key: string, value: unknown): void;
  json(body: unknown, status?: number): HonoResponse;
}

type HonoNext = () => Promise<void>;
type HonoResponse = Response | undefined;

interface FastifyRequest {
  headers: Record<string, string | string[] | undefined>;
  aat?: Extract<VerifyResult, { valid: true }>;
  [key: string]: unknown;
}

interface FastifyReply {
  status(code: number): FastifyReply;
  send(payload: unknown): Promise<void>;
}
