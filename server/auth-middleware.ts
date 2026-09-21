/**
 * Route protection for the ink-finance API.
 *
 * Everything under `/api` requires a valid Auth.js session cookie, with two
 * deliberate exceptions:
 *
 *   1. `/api/health` — the keepalive GitHub Action pings it every 10 minutes
 *      to stop Render's free tier suspending the service. It must stay open.
 *   2. Requests carrying the shared `X-Service-Token` header — the Telegram
 *      bot is a server-to-server client with no browser and no cookie, so it
 *      authenticates with a secret instead.
 *
 * Auth.js's own endpoints (`/api/auth/*`) are mounted separately and are never
 * reached by this middleware.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getSession } from '@auth/express';
import { SERVICE_TOKEN, authConfig } from './auth.js';

/** Paths that never require authentication (matched against the full path). */
const PUBLIC_PATHS = ['/api/health'];
/** Prefixes handled by Auth.js itself, which must not be gated. */
const PUBLIC_PREFIXES = ['/api/auth/'];

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function requireApiAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // `req.path` is relative to this middleware's mount point, so use the full
  // path — otherwise mounting at '/api' would turn '/api/health' into
  // '/health' and the public check would never match.
  const fullPath = (req.originalUrl || req.url).split('?')[0];

  if (PUBLIC_PATHS.includes(fullPath) || PUBLIC_PREFIXES.some((p) => fullPath.startsWith(p))) {
    next();
    return;
  }

  // ── Server-to-server client (the Telegram bot) ────────────
  const serviceToken = req.get('x-service-token');
  if (serviceToken && SERVICE_TOKEN && safeEqual(serviceToken, SERVICE_TOKEN)) {
    next();
    return;
  }

  // ── Browser session ───────────────────────────────────────
  try {
    const session = await getSession(req, authConfig);
    if (session?.user) {
      (req as Request & { session?: unknown }).session = session;
      next();
      return;
    }
  } catch (err) {
    console.error('[auth] session lookup failed:', err);
  }

  res.status(401).json({ error: 'Unauthorized' });
}
