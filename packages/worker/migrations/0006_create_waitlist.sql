-- Migration: 0006_create_waitlist.sql
-- Lead capture for paid tiers (Starter, Pro) before Stripe is live.
-- Replaces mailto CTAs on the pricing page.

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  company TEXT,
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fast lookup by email (deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_tier ON waitlist(email, tier);

-- List by tier for outreach batching
CREATE INDEX IF NOT EXISTS idx_waitlist_tier ON waitlist(tier, created_at);
