-- SCITT Transparency Service tables
-- Stores Merkle tree state and Receipts for SCITT-compatible attestations

-- Tree state: single row per tree (global singleton for now)
CREATE TABLE IF NOT EXISTS scitt_tree_state (
  id TEXT PRIMARY KEY DEFAULT 'global',
  tree_size INTEGER NOT NULL DEFAULT 0,
  nodes_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Receipts: one per registered Signed Statement
CREATE TABLE IF NOT EXISTS scitt_receipts (
  entry_id TEXT PRIMARY KEY,
  leaf_index INTEGER NOT NULL,
  tree_size INTEGER NOT NULL,
  root_hash TEXT NOT NULL,
  receipt_cbor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Index for tree integrity queries
CREATE INDEX IF NOT EXISTS idx_scitt_receipts_leaf ON scitt_receipts(leaf_index);
