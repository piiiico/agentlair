/**
 * Unit tests for @agentlair/bcc-primitive verifier SDK.
 *
 * Uses mocked fetch to assert shape conformance against BCCResolution contract.
 * No network calls are made.
 */

import { describe, expect, it } from "bun:test";
import { verifyBCC } from "./index.js";
import type { BCCResolution, AgentLairBCCResponse, CommitTrustResponse } from "./types.js";

// -------------------------------------------------------------------------
// Mock helpers
// -------------------------------------------------------------------------

function mockFetch(status: number, body: unknown): typeof fetch {
  return ((_url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve({
      ok:     status >= 200 && status < 300,
      status,
      json:   () => Promise.resolve(body),
      headers: new Headers(),
    } as Response)
  ) as typeof fetch;
}

// -------------------------------------------------------------------------
// Canonical AgentLair response fixture
// -------------------------------------------------------------------------

const AGENTLAIR_FIXTURE: AgentLairBCCResponse = {
  credential_id: "cred_agent_001",
  valid:         true,
  profile:       "BCC-Capital",
  stake: {
    medium: "capital",
    amount: 1.0,
    unit:   "ETH",
  },
  oracle_state: "active",
  evidence_chain: [
    {
      type:      "onchain_tx",
      ref:       "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      timestamp: "2026-06-01T00:00:00Z",
    },
  ],
  issuer:  "did:web:agentlair.dev",
  subject: "did:web:agentlair.dev:agents:acc_test",
  window: {
    start: "2026-06-01T00:00:00Z",
    end:   "2031-06-01T00:00:00Z",
  },
};

// -------------------------------------------------------------------------
// AgentLair verifier tests
// -------------------------------------------------------------------------

describe("verifyBCC — AgentLair source", () => {
  it("returns a valid BCCResolution from an AgentLair response", async () => {
    const result = await verifyBCC("cred_agent_001", {
      source:  "agentlair",
      fetchFn: mockFetch(200, AGENTLAIR_FIXTURE),
    });

    // Shape conformance assertions
    expect(result.credential_id).toBe("cred_agent_001");
    expect(result.valid).toBe(true);
    expect(result.profile).toBe("BCC-Capital");
    expect(result.stake.medium).toBe("capital");
    expect(result.stake.amount).toBe(1.0);
    expect(result.stake.unit).toBe("ETH");
    expect(result.oracle_state).toBe("active");
    expect(Array.isArray(result.evidence_chain)).toBe(true);
    expect(result.evidence_chain.length).toBe(1);
    expect(result.evidence_chain[0]!.type).toBe("onchain_tx");
    expect(result.issuer).toBe("did:web:agentlair.dev");
    expect(result.subject).toBe("did:web:agentlair.dev:agents:acc_test");
    expect(result.window.start).toBe("2026-06-01T00:00:00Z");
    expect(result.window.end).toBe("2031-06-01T00:00:00Z");
  });

  it("throws on 404 from AgentLair", async () => {
    await expect(
      verifyBCC("nonexistent", {
        source:  "agentlair",
        fetchFn: mockFetch(404, { error: "not_found" }),
      })
    ).rejects.toThrow("BCC not found: nonexistent");
  });

  it("throws on 410 from AgentLair (revoked)", async () => {
    await expect(
      verifyBCC("revoked_cred", {
        source:  "agentlair",
        fetchFn: mockFetch(410, { error: "revoked" }),
      })
    ).rejects.toThrow("BCC revoked: revoked_cred");
  });

  it("throws on unexpected HTTP error from AgentLair", async () => {
    await expect(
      verifyBCC("cred_x", {
        source:  "agentlair",
        fetchFn: mockFetch(500, { error: "internal_server_error" }),
      })
    ).rejects.toThrow("AgentLair verifier error: HTTP 500");
  });
});

// -------------------------------------------------------------------------
// BCC-Existence (PoPA) fixture — open-ended window, self_revealing oracle
// -------------------------------------------------------------------------

const POPA_FIXTURE: AgentLairBCCResponse = {
  credential_id: "cred_popa_001",
  valid:         true,
  profile:       "BCC-Existence",
  stake: {
    medium: "existence",
    amount: 127,
    unit:   "attestation_days",
  },
  oracle_state: "self_revealing",
  evidence_chain: [
    {
      type:      "scitt_entry",
      ref:       "scitt:entry_abc123",
      timestamp: "2026-05-02T00:01:00Z",
    },
  ],
  issuer:  "did:web:agentlair.dev",
  subject: "did:web:agentlair.dev:agents:acc_xyz",
  window: {
    start: "2026-01-01T00:00:00Z",
    end:   null,
  },
};

describe("verifyBCC — BCC-Existence / PoPA fixture", () => {
  it("handles open-ended window (end: null)", async () => {
    const result = await verifyBCC("cred_popa_001", {
      source:  "agentlair",
      fetchFn: mockFetch(200, POPA_FIXTURE),
    });

    expect(result.profile).toBe("BCC-Existence");
    expect(result.oracle_state).toBe("self_revealing");
    expect(result.stake.medium).toBe("existence");
    expect(result.window.end).toBeNull();
  });
});

// -------------------------------------------------------------------------
// Commit verifier tests
// -------------------------------------------------------------------------

const COMMIT_FIXTURE_FULL: CommitTrustResponse = {
  credential_id: "commit_cred_001",
  valid:         true,
  profile:       "BCC-Capital",
  stake: {
    medium: "capital",
    amount: 0.5,
    unit:   "ETH",
  },
  oracle_state: "active",
  evidence_chain: [
    {
      type:      "onchain_tx",
      ref:       "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      timestamp: "2026-05-15T12:00:00Z",
    },
  ],
  issuer:  "did:web:getcommit.dev",
  subject: "github_repo:example/project",
  window: {
    start: "2026-05-15T00:00:00Z",
    end:   "2027-05-15T00:00:00Z",
  },
};

describe("verifyBCC — Commit source (full response)", () => {
  it("normalises a full Commit response to BCCResolution", async () => {
    const result = await verifyBCC("commit_cred_001", {
      source:  "commit",
      fetchFn: mockFetch(200, COMMIT_FIXTURE_FULL),
    });

    expect(result.credential_id).toBe("commit_cred_001");
    expect(result.valid).toBe(true);
    expect(result.profile).toBe("BCC-Capital");
    expect(result.stake.medium).toBe("capital");
    expect(result.stake.amount).toBe(0.5);
    expect(result.oracle_state).toBe("active");
    expect(result.issuer).toBe("did:web:getcommit.dev");
    expect(result.subject).toBe("github_repo:example/project");
    expect(result.window.end).toBe("2027-05-15T00:00:00Z");
  });
});

describe("verifyBCC — Commit source (partial response — sane defaults)", () => {
  it("fills missing fields from sane defaults and does not throw", async () => {
    const SPARSE: CommitTrustResponse = {
      id:    "commit_sparse_001",
      valid: false,
      // profile, stake, oracle_state, evidence_chain missing
    };

    const result = await verifyBCC("commit_sparse_001", {
      source:  "commit",
      fetchFn: mockFetch(200, SPARSE),
    });

    // Should not throw — defaults applied
    expect(result.credential_id).toBe("commit_sparse_001");
    expect(result.valid).toBe(false);
    expect(result.profile).toBe("BCC-Capital"); // default
    expect(result.oracle_state).toBe("active");  // default
    expect(Array.isArray(result.evidence_chain)).toBe(true);
    expect(result.evidence_chain).toHaveLength(0);
  });
});

describe("verifyBCC — Commit source entity_id fallback", () => {
  it("uses entity_id as subject when subject is absent", async () => {
    const fixture: CommitTrustResponse = {
      credential_id: "cred_biz_001",
      valid:         true,
      entity_id:     "brreg:123456789",
    };

    const result = await verifyBCC("cred_biz_001", {
      source:  "commit",
      fetchFn: mockFetch(200, fixture),
    });

    expect(result.subject).toBe("brreg:123456789");
  });
});

// -------------------------------------------------------------------------
// Shape contract: all required fields present in BCCResolution
// -------------------------------------------------------------------------

describe("BCCResolution shape contract", () => {
  it("result has all required top-level fields", async () => {
    const result: BCCResolution = await verifyBCC("cred_agent_001", {
      source:  "agentlair",
      fetchFn: mockFetch(200, AGENTLAIR_FIXTURE),
    });

    const requiredFields: (keyof BCCResolution)[] = [
      "credential_id",
      "valid",
      "profile",
      "stake",
      "oracle_state",
      "evidence_chain",
      "issuer",
      "subject",
      "window",
    ];

    for (const field of requiredFields) {
      expect(result).toHaveProperty(field);
    }

    expect(result.stake).toHaveProperty("medium");
    expect(result.stake).toHaveProperty("amount");
    expect(result.stake).toHaveProperty("unit");
    expect(result.window).toHaveProperty("start");
    expect(result.window).toHaveProperty("end");
  });
});
