#!/usr/bin/env bun
/**
 * AgentLair Email Channel for Claude Code
 *
 * Two-way email channel that routes inbound AgentLair emails into Claude Code
 * sessions. Claude reads the email, takes action, and replies via send_email.
 *
 * State lives in ~/.claude/channels/agentlair-email/:
 *   .env          — AGENTLAIR_API_KEY, AGENTLAIR_ADDRESS (written by /agentlair-email:configure)
 *   access.json   — allowed senders (managed by /agentlair-email:access)
 *
 * Configuration sources (env > .env file):
 *   AGENTLAIR_API_KEY    — required. AgentLair API key (al_live_...)
 *   AGENTLAIR_ADDRESS    — required. The @agentlair.dev address to monitor
 *   AGENTLAIR_BASE_URL   — optional. Default: https://agentlair.dev
 *   POLL_INTERVAL_MS     — optional. Polling interval in ms. Default: 300000 (5 min)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── State directory ──────────────────────────────────────────────────────────

const STATE_DIR = join(homedir(), '.claude', 'channels', 'agentlair-email')
const ENV_FILE = join(STATE_DIR, '.env')
const ACCESS_FILE = join(STATE_DIR, 'access.json')

// Load .env into process.env. Real env wins.
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

// ── Config ───────────────────────────────────────────────────────────────────

const API_KEY = process.env.AGENTLAIR_API_KEY
const ADDRESS = process.env.AGENTLAIR_ADDRESS
const BASE_URL = process.env.AGENTLAIR_BASE_URL ?? 'https://agentlair.dev'
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '300000', 10)

if (!API_KEY || !ADDRESS) {
  process.stderr.write(
    `agentlair-email: AGENTLAIR_API_KEY and AGENTLAIR_ADDRESS required\n` +
    `  set in ${ENV_FILE}\n` +
    `  or run /agentlair-email:configure to set up\n`,
  )
  process.exit(1)
}

// ── Access control ───────────────────────────────────────────────────────────

interface AccessConfig {
  /** 'allowlist' = only listed senders; 'open' = accept all */
  policy: 'allowlist' | 'open'
  /** Email addresses allowed to send (lowercase) */
  allowFrom: string[]
}

function loadAccess(): AccessConfig {
  try {
    const raw = JSON.parse(readFileSync(ACCESS_FILE, 'utf8'))
    return {
      policy: raw.policy ?? 'open',
      allowFrom: (raw.allowFrom ?? []).map((s: string) => s.toLowerCase()),
    }
  } catch {
    // Missing file = open policy (first-time setup)
    return { policy: 'open', allowFrom: [] }
  }
}

function isAllowed(sender: string): boolean {
  const access = loadAccess()
  if (access.policy === 'open') return true
  return access.allowFrom.includes(sender.toLowerCase())
}

// ── AgentLair API client ─────────────────────────────────────────────────────

interface InboxMessage {
  message_id: string
  message_id_url: string
  from: string
  to: string
  subject: string
  snippet: string
  received_at: string
  read: boolean
}

interface FullMessage extends InboxMessage {
  body: string
  html: string | null
  date_header: string
}

async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`AgentLair API ${path} → ${resp.status}: ${err}`)
  }
  return resp.json() as Promise<T>
}

async function getInbox(): Promise<InboxMessage[]> {
  const data = await apiGet<{ messages: InboxMessage[] }>(
    `/v1/email/inbox?address=${encodeURIComponent(ADDRESS!)}`,
  )
  return data.messages ?? []
}

async function getFullMessage(messageIdUrl: string): Promise<FullMessage> {
  return apiGet<FullMessage>(
    `/v1/email/messages/${messageIdUrl}?address=${encodeURIComponent(ADDRESS!)}`,
  )
}

async function sendEmailApi(
  from: string,
  to: string,
  subject: string,
  text: string,
): Promise<{ id: string }> {
  const resp = await fetch(`${BASE_URL}/v1/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`AgentLair send → ${resp.status}: ${err}`)
  }
  return resp.json() as Promise<{ id: string }>
}

// ── MCP server ───────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'agentlair-email', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: `
You are monitoring the email address ${ADDRESS} via AgentLair.

Inbound emails arrive as <channel source="agentlair-email" ...> tags with these attributes:
  - message_id: unique email ID
  - from: sender's email address
  - subject: email subject line
  - received_at: ISO timestamp

The tag body contains the full plain-text email content.

When you receive an email:
1. Read it carefully
2. Decide if action is needed
3. If you want to reply, use the send_email tool with:
   - from: ${ADDRESS} (always use this as the sender)
   - to: the sender's email from the 'from' attribute
   - subject: typically "Re: <original subject>"
   - text: your reply

The user has configured this channel — treat emails as genuine communication worth acting on.
`.trim(),
  },
)

// ── Tools: send_email ────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_email',
      description:
        'Send an email via AgentLair. Use to reply to inbound emails or compose new messages.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address',
          },
          subject: {
            type: 'string',
            description: 'Email subject line',
          },
          text: {
            type: 'string',
            description: 'Plain-text email body',
          },
          from: {
            type: 'string',
            description: `Sender address. Defaults to ${ADDRESS}. Must be an @agentlair.dev address you own.`,
          },
        },
        required: ['to', 'subject', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'send_email') {
    const { to, subject, text, from } = req.params.arguments as {
      to: string
      subject: string
      text: string
      from?: string
    }
    const sender = from ?? ADDRESS!
    try {
      const result = await sendEmailApi(sender, to, subject, text)
      return {
        content: [
          {
            type: 'text',
            text: `Email sent successfully. ID: ${result.id}`,
          },
        ],
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to send email: ${(err as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }
  throw new Error(`Unknown tool: ${req.params.name}`)
})

// ── Polling loop ─────────────────────────────────────────────────────────────

const seenIds = new Set<string>()
let initialized = false

async function poll() {
  try {
    const messages = await getInbox()

    // On first poll, mark all existing messages as seen (don't backfill history)
    if (!initialized) {
      for (const msg of messages) {
        seenIds.add(msg.message_id)
      }
      initialized = true
      process.stderr.write(
        `[agentlair-email] Initialized. Monitoring ${ADDRESS}. ${messages.length} existing message(s) skipped.\n`,
      )
      return
    }

    // Process new messages
    for (const msg of messages) {
      if (seenIds.has(msg.message_id)) continue

      // Access control — re-read on every message (no restart needed)
      if (!isAllowed(msg.from)) {
        process.stderr.write(
          `[agentlair-email] Dropped message from blocked sender: ${msg.from}\n`,
        )
        seenIds.add(msg.message_id)
        continue
      }

      // Fetch full message body
      let fullMsg: FullMessage
      try {
        fullMsg = await getFullMessage(msg.message_id_url)
      } catch (err) {
        process.stderr.write(
          `[agentlair-email] Failed to fetch message ${msg.message_id}: ${(err as Error).message}\n`,
        )
        continue
      }

      seenIds.add(msg.message_id)

      // Emit channel notification
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: fullMsg.body?.trim() ?? msg.snippet,
          meta: {
            message_id: msg.message_id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64),
            from: msg.from,
            subject: msg.subject,
            received_at: msg.received_at,
          },
        },
      })

      process.stderr.write(
        `[agentlair-email] Forwarded email from ${msg.from}: "${msg.subject}"\n`,
      )
    }
  } catch (err) {
    process.stderr.write(
      `[agentlair-email] Poll error: ${(err as Error).message}\n`,
    )
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport())

process.stderr.write(
  `[agentlair-email] Channel started. Polling ${ADDRESS} every ${POLL_MS / 1000}s.\n`,
)

// Initial poll immediately, then on interval
await poll()
setInterval(poll, POLL_MS)
