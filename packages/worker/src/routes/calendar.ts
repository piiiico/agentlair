// ─── Calendar Routes ───────────────────────────────────────────────────────────
// Handles: /v1/calendar/*
//
// Agent-owned calendar. Each AgentLair account gets its own calendar:
//   - Events stored in EMAILS KV with cal: prefix (no new KV namespace needed)
//   - Agents create/list/delete events via JSON API
//   - Public iCal feed URL for subscribing from Google Calendar / Apple Calendar
//
// Routes (all authenticated except feed.ics):
//   POST   /v1/calendar/events         — create an event
//   GET    /v1/calendar/events         — list events (?from=ISO&to=ISO optional)
//   DELETE /v1/calendar/events/{id}    — delete an event
//   GET    /v1/calendar/feed           — get (or generate) public iCal subscription URL
//   GET    /v1/calendar/feed.ics?cal_token= — public iCal feed (no auth required)
//
// Storage layout in EMAILS KV:
//   cal-event:{account_id}:{event_id}  → CalEvent JSON
//   cal-index:{account_id}             → CalIndexEntry[] (newest first, cap 200)
//   cal-token-by-account:{account_id}  → cal_token string
//   cal-token:{cal_token}              → account_id string

import { nanoid, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';
import { SERVICE_PRICES, X402_CONFIG, verifyX402Payment, make402Response, checkSpendingCap } from '../x402.js';
import { recordBudgetSpend } from '../middleware/budget.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string;
  summary: string;
  start: string;       // ISO 8601 date or datetime
  end: string;         // ISO 8601 date or datetime
  description?: string;
  location?: string;
  attendees?: string[]; // email addresses
  created_at: string;
  updated_at: string;
}

interface CalIndexEntry {
  id: string;
  summary: string;
  start: string;
  end: string;
}

// ─── Limits ───────────────────────────────────────────────────────────────────

const CALENDAR_LIMITS = {
  free: { max_events: 100 },
  paid: { max_events: 10000 },
};

// ─── iCalendar helpers ────────────────────────────────────────────────────────

/** Escape iCalendar text values (RFC 5545 §3.3.11) */
function icalEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Fold long iCalendar lines at 75 chars (RFC 5545 §3.1) */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let offset = 75;
  while (offset < line.length) {
    chunks.push(' ' + line.slice(offset, offset + 74));
    offset += 74;
  }
  return chunks.join('\r\n');
}

/**
 * Convert ISO 8601 date/datetime to iCalendar DTSTART/DTEND property.
 * - "2026-03-20"           → "DTSTART;VALUE=DATE:20260320"
 * - "2026-03-20T12:00:00Z" → "DTSTART:20260320T120000Z"
 * - "2026-03-20T12:00:00"  → "DTSTART:20260320T120000" (floating time)
 */
function toIcalDateProp(propName: string, iso: string): string {
  // Date-only (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const value = iso.replace(/-/g, '');
    return `${propName};VALUE=DATE:${value}`;
  }
  // DateTime with Z suffix (UTC)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) {
    const value = iso.replace(/[-:]/g, '').replace('.000', '');
    return `${propName}:${value}`;
  }
  // DateTime without timezone (floating) — strip punctuation
  const value = iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace('T', 'T');
  return `${propName}:${value}`;
}

/** Render a CalEvent as a VEVENT block */
function renderVEvent(event: CalEvent, organizerEmail?: string): string {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${event.id}@agentlair.dev`,
    toIcalDateProp('DTSTART', event.start),
    toIcalDateProp('DTEND', event.end),
    `SUMMARY:${icalEscape(event.summary)}`,
    `DTSTAMP:${new Date(event.created_at).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${icalEscape(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${icalEscape(event.location)}`);
  }
  if (organizerEmail) {
    lines.push(`ORGANIZER:mailto:${organizerEmail}`);
  }
  if (event.attendees && event.attendees.length > 0) {
    for (const attendee of event.attendees) {
      lines.push(`ATTENDEE:mailto:${attendee}`);
    }
  }

  lines.push('END:VEVENT');
  return lines.map(foldLine).join('\r\n');
}

/** Render all events as a VCALENDAR iCalendar document */
function renderICalendar(events: CalEvent[], calName: string, organizerEmail?: string): string {
  const vevents = events.map(e => renderVEvent(e, organizerEmail)).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgentLair//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalEscape(calName)}`,
    `X-WR-TIMEZONE:UTC`,
    vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}

// ─── Shared event creation logic ──────────────────────────────────────────────

interface CreateEventResult {
  event: CalEvent;
  indexEntry: CalIndexEntry;
}

/** Validate and create a CalEvent from raw input. Returns error string or event. */
function validateEventInput(body: Record<string, unknown>): string | { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[] } {
  const { summary, start, end, description, location, attendees } = body as {
    summary?: unknown; start?: unknown; end?: unknown;
    description?: unknown; location?: unknown; attendees?: unknown;
  };

  if (!summary || typeof summary !== 'string') return 'summary required (string)';
  if (summary.length > 200) return 'summary must be 200 characters or fewer';
  if (!start || typeof start !== 'string') return 'start required (ISO 8601 date or datetime)';
  if (!end || typeof end !== 'string') return 'end required (ISO 8601 date or datetime)';

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z?)?$/.test(s);
  if (!isValidDate(start)) return 'start must be ISO 8601 (e.g. "2026-03-20" or "2026-03-20T14:00:00Z")';
  if (!isValidDate(end)) return 'end must be ISO 8601 (e.g. "2026-03-20" or "2026-03-20T15:00:00Z")';
  if (end < start) return 'end must not be before start';

  if (description !== undefined && typeof description === 'string' && description.length > 5000) return 'description must be 5000 characters or fewer';
  if (location !== undefined && typeof location === 'string' && location.length > 500) return 'location must be 500 characters or fewer';

  return {
    summary: String(summary).trim(),
    start,
    end,
    description: description ? String(description).trim() : undefined,
    location: location ? String(location).trim() : undefined,
    attendees: Array.isArray(attendees) ? attendees.map(String) : undefined,
  };
}

async function createEvent(env: Env, accountId: string, input: { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[] }): Promise<CreateEventResult> {
  const eventId = 'evt_' + nanoid(20);
  const now = new Date().toISOString();

  const event: CalEvent = {
    id: eventId,
    summary: input.summary,
    start: input.start,
    end: input.end,
    description: input.description,
    location: input.location,
    attendees: input.attendees,
    created_at: now,
    updated_at: now,
  };

  await env.EMAILS.put('cal-event:' + accountId + ':' + eventId, JSON.stringify(event));

  const index = await getCalIndex(env, accountId);
  const indexEntry: CalIndexEntry = { id: eventId, summary: event.summary, start: input.start, end: input.end };
  index.unshift(indexEntry);
  await saveCalIndex(env, accountId, index);

  return { event, indexEntry };
}

// ─── KV helpers ───────────────────────────────────────────────────────────────

async function getCalIndex(env: Env, accountId: string): Promise<CalIndexEntry[]> {
  const raw = await env.EMAILS.get('cal-index:' + accountId);
  return raw ? JSON.parse(raw) : [];
}

async function saveCalIndex(env: Env, accountId: string, index: CalIndexEntry[]): Promise<void> {
  const capped = index.slice(0, 200);
  await env.EMAILS.put('cal-index:' + accountId, JSON.stringify(capped));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handleCalendarRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // ── Public: iCal feed (no auth required) ──────────────────────────────────

  if (path === '/v1/calendar/feed.ics' && method === 'GET') {
    const calToken = url.searchParams.get('cal_token');
    if (!calToken) {
      return new Response('cal_token query parameter required', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    const accountId = await env.EMAILS.get('cal-token:' + calToken);
    if (!accountId) {
      return new Response('Invalid or expired calendar token', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }

    const index = await getCalIndex(env, accountId);
    const events: CalEvent[] = [];
    for (const entry of index) {
      const raw = await env.EMAILS.get('cal-event:' + accountId + ':' + entry.id);
      if (raw) events.push(JSON.parse(raw));
    }

    // Read custom calendar name (if set)
    const calName = await env.EMAILS.get('cal-name:' + accountId) || 'AgentLair Calendar';

    // Sort by start time, newest first (already newest-first in index)
    const ical = renderICalendar(events, calName);
    return new Response(ical, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="agentlair.ics"',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // ── Public: add event via cal_token (shared calendar write access) ────────

  if (path === '/v1/calendar/events' && method === 'POST' && url.searchParams.get('cal_token')) {
    const calToken = url.searchParams.get('cal_token')!;
    const accountId = await env.EMAILS.get('cal-token:' + calToken);
    if (!accountId) {
      return err('Invalid or expired calendar token', 404, 'invalid_token');
    }

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const validated = validateEventInput(body);
    if (typeof validated === 'string') {
      return err(validated, 400, 'invalid_input');
    }

    // Check event limit (use free tier limit for shared access)
    const index = await getCalIndex(env, accountId);
    if (index.length >= CALENDAR_LIMITS.free.max_events) {
      return err('Calendar event limit reached.', 403, 'calendar_limit_reached');
    }

    const { event } = await createEvent(env, accountId, validated);

    return json({
      event_id: event.id,
      summary: event.summary,
      start: event.start,
      end: event.end,
      description: event.description,
      created_at: event.created_at,
      note: 'Event added to shared calendar.',
    }, 201);
  }

  // ── All other routes require authentication ────────────────────────────────

  if (!account) return null;
  if (!path.startsWith('/v1/calendar')) return null;

  const limits = CALENDAR_LIMITS[account.tier as keyof typeof CALENDAR_LIMITS] || CALENDAR_LIMITS.free;

  // GET /v1/calendar/feed — get or generate public iCal subscription URL
  if (path === '/v1/calendar/feed' && method === 'GET') {
    let calToken = await env.EMAILS.get('cal-token-by-account:' + account.id);

    if (!calToken) {
      // Generate a new calendar token
      calToken = 'ct_' + nanoid(32);
      await env.EMAILS.put('cal-token-by-account:' + account.id, calToken);
      await env.EMAILS.put('cal-token:' + calToken, account.id);
    }

    const baseUrl = new URL(request.url).origin;
    const feedUrl = `${baseUrl}/v1/calendar/feed.ics?cal_token=${calToken}`;

    return json({
      feed_url: feedUrl,
      cal_token: calToken,
      note: 'Subscribe to this URL from any calendar app (Google Calendar, Apple Calendar, Outlook). The feed is public — share carefully or regenerate if compromised.',
      how_to_subscribe: 'In Google Calendar: Other Calendars → From URL → paste feed_url',
    });
  }

  // POST /v1/calendar/events — create a new event
  if (path === '/v1/calendar/events' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const { summary, start, end, description, location, attendees } = body as {
      summary?: unknown; start?: unknown; end?: unknown;
      description?: unknown; location?: unknown; attendees?: unknown;
    };

    if (!summary || typeof summary !== 'string') {
      return err('summary required (string)', 400, 'invalid_summary');
    }
    if (summary.length > 200) {
      return err('summary must be 200 characters or fewer', 400, 'invalid_summary');
    }
    if (!start || typeof start !== 'string') {
      return err('start required (ISO 8601 date or datetime)', 400, 'invalid_start');
    }
    if (!end || typeof end !== 'string') {
      return err('end required (ISO 8601 date or datetime)', 400, 'invalid_end');
    }

    // Validate ISO 8601 format (requires seconds when time component present)
    const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z?)?$/.test(s);
    if (!isValidDate(start)) {
      return err('start must be ISO 8601 (e.g. "2026-03-20" or "2026-03-20T14:00:00Z")', 400, 'invalid_start');
    }
    if (!isValidDate(end)) {
      return err('end must be ISO 8601 (e.g. "2026-03-20" or "2026-03-20T15:00:00Z")', 400, 'invalid_end');
    }
    // Validate chronological order (ISO 8601 lexicographic comparison is valid for same format)
    if (end < start) {
      return err('end must not be before start', 400, 'invalid_date_range');
    }

    // Field length limits
    if (description !== undefined && typeof description === 'string' && description.length > 5000) {
      return err('description must be 5000 characters or fewer', 400, 'invalid_description');
    }
    if (location !== undefined && typeof location === 'string' && location.length > 500) {
      return err('location must be 500 characters or fewer', 400, 'invalid_location');
    }
    if (attendees !== undefined && !Array.isArray(attendees)) {
      return err('attendees must be an array of email addresses', 400, 'invalid_attendees');
    }
    if (Array.isArray(attendees)) {
      if (attendees.length > 20) {
        return err('attendees must have 20 entries or fewer', 400, 'invalid_attendees');
      }
      for (const a of attendees) {
        if (typeof a === 'string' && a.length > 254) {
          return err('each attendee email must be 254 characters or fewer', 400, 'invalid_attendees');
        }
      }
    }

    // Check event limit
    const index = await getCalIndex(env, account.id);
    if (index.length >= limits.max_events) {
      // Free tier limit reached — allow bypass via x402 payment
      const paymentHeader = request.headers.get('X-PAYMENT');
      if (!paymentHeader) {
        return make402Response(SERVICE_PRICES.calendar_event, {
          calendar_limit: {
            current: index.length,
            limit: limits.max_events,
            tier: account.tier || 'free',
            upgrade_url: 'https://agentlair.dev/pricing',
          },
        });
      }
      // Verify the x402 payment
      const verification = await verifyX402Payment(paymentHeader, SERVICE_PRICES.calendar_event);
      if (!verification.valid) {
        return new Response(JSON.stringify({
          error: 'payment_invalid',
          message: verification.error,
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json', 'X-402-Version': String(X402_CONFIG.x402Version) },
        });
      }
      // Check spending caps if this is a pod account
      if (account.type === 'pod' && account.pod_id) {
        try {
          const podRaw = await env.KEYS.get('pod:' + account.pod_id);
          if (podRaw) {
            const pod = JSON.parse(podRaw);
            if (pod.spending_caps) {
              const capCheck = await checkSpendingCap(env, account.id, SERVICE_PRICES.calendar_event.amount, pod.spending_caps);
              if (!capCheck.allowed) {
                const periodLabel = capCheck.exceeded || 'period';
                const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(2);
                const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(2);
                return new Response(JSON.stringify({
                  error: `Spending cap exceeded: ${periodLabel} limit of ${capUsdc} USDC reached (current: ${currentUsdc} USDC). Payment blocked by pod spending cap.`,
                  code: 'spending_cap_exceeded',
                  cap: { period: periodLabel, limit_usdc: capUsdc, current_usdc: currentUsdc },
                }), {
                  status: 402,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
            }
          }
        } catch { /* fail-open: don't block payment for cap check error */ }
      }
      // Payment verified — allow event creation beyond limit
    }

    const eventId = 'evt_' + nanoid(20);
    const now = new Date().toISOString();

    const event: CalEvent = {
      id: eventId,
      summary: summary.trim(),
      start,
      end,
      description: description ? String(description).trim() : undefined,
      location: location ? String(location).trim() : undefined,
      attendees: attendees ? attendees.map(String) : undefined,
      created_at: now,
      updated_at: now,
    };

    // Store event
    await env.EMAILS.put('cal-event:' + account.id + ':' + eventId, JSON.stringify(event));

    // Update index (newest first)
    const indexEntry: CalIndexEntry = { id: eventId, summary: event.summary, start, end };
    index.unshift(indexEntry);
    await saveCalIndex(env, account.id, index);

    // Record budget spend (fire-and-forget — non-critical)
    ctx.waitUntil(recordBudgetSpend(env, account.id, parseInt(SERVICE_PRICES.calendar_event.amount)));

    return json({
      event_id: eventId,
      summary: event.summary,
      start: event.start,
      end: event.end,
      description: event.description,
      location: event.location,
      attendees: event.attendees,
      created_at: event.created_at,
      note: 'Event created. Subscribers to your iCal feed will see this event. GET /v1/calendar/feed for your subscription URL.',
    }, 201);
  }

  // GET /v1/calendar/events — list events
  if (path === '/v1/calendar/events' && method === 'GET') {
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const limitParam = parseInt(url.searchParams.get('limit') || '50');
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);

    const index = await getCalIndex(env, account.id);

    // Optional date range filter (on start field)
    let filtered = index;
    if (fromParam) filtered = filtered.filter(e => e.start >= fromParam);
    if (toParam) filtered = filtered.filter(e => e.start <= toParam);

    // Apply limit
    const sliced = filtered.slice(0, limit);

    // Fetch full event data for each (parallel)
    const events = await Promise.all(
      sliced.map(async entry => {
        const raw = await env.EMAILS.get('cal-event:' + account.id + ':' + entry.id);
        return raw ? JSON.parse(raw) : null;
      }),
    );

    const validEvents = events.filter(Boolean);

    return json({
      events: validEvents,
      count: validEvents.length,
      total: index.length,
      limit,
      note: validEvents.length === 0
        ? 'No events found. Create events with POST /v1/calendar/events.'
        : undefined,
    });
  }

  // DELETE /v1/calendar/events/{event_id} — delete an event
  const deleteMatch = path.match(/^\/v1\/calendar\/events\/([A-Za-z0-9_-]{1,40})$/);
  if (deleteMatch && method === 'DELETE') {
    const eventId = deleteMatch[1];
    const eventKey = 'cal-event:' + account.id + ':' + eventId;

    const raw = await env.EMAILS.get(eventKey);
    if (!raw) {
      return err('Event not found', 404, 'not_found');
    }

    await env.EMAILS.delete(eventKey);

    // Remove from index
    const index = await getCalIndex(env, account.id);
    await saveCalIndex(env, account.id, index.filter(e => e.id !== eventId));

    return json({ event_id: eventId, deleted: true });
  }

  // PUT /v1/calendar/settings — update calendar settings (name, etc.)
  if (path === '/v1/calendar/settings' && method === 'PUT') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const { name } = body as { name?: unknown };

    if (!name || typeof name !== 'string') {
      return err('name required (string, 1-100 characters)', 400, 'invalid_name');
    }
    if (name.length > 100) {
      return err('name must be 100 characters or fewer', 400, 'invalid_name');
    }

    await env.EMAILS.put('cal-name:' + account.id, name.trim());

    return json({
      name: name.trim(),
      note: 'Calendar name updated. It may take a few hours for subscribed calendar apps to refresh.',
    });
  }

  // GET /v1/calendar/settings — get calendar settings
  if (path === '/v1/calendar/settings' && method === 'GET') {
    const name = await env.EMAILS.get('cal-name:' + account.id) || 'AgentLair Calendar';
    return json({ name });
  }

  // Catch-all for /v1/calendar/*
  if (path.startsWith('/v1/calendar')) {
    return json({
      available: [
        'POST /v1/calendar/events — create event (body: {summary, start, end, description?, location?, attendees?})',
        'GET /v1/calendar/events — list events (?from=ISO&to=ISO&limit=N optional)',
        'DELETE /v1/calendar/events/{event_id} — delete event',
        'GET /v1/calendar/feed — get public iCal subscription URL',
        'GET /v1/calendar/feed.ics?cal_token= — public iCal feed (no auth)',
      ],
      limits,
      note: 'Agent-owned calendar. Events are published via iCal feed for human subscription. RFC 5545 compliant.',
    });
  }

  return null;
}
