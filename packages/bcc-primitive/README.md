# @agentlair/bcc-primitive

BCC primitive consumed by AgentLair (agents) and Commit (humans/businesses).

The verifier API contract is the response shape both sides MUST honour.
Carve into standalone repo (`agentlair/bcc-primitive`) when Commit's first import lands.

**Parent decision:** [`memory/research/agentlair-commit-shared-primitive-2026-05.md`](../../memory/research/agentlair-commit-shared-primitive-2026-05.md)

---

## What this package contains

| Path | Contents |
|------|----------|
| `schemas/bcc-v1.jsonld` | JSON-LD context for BCC v1 (W3C VC 2.0 envelope) |
| `schemas/cose-popa-header.cddl` | CDDL schema for PoPA COSE protected header |
| `schemas/endorsement-v1.jsonld` | Stub schema for Commit-side endorsement credentials (TODO markers) |
| `contracts/src/CBP.sol` | Capital-Bonded Pledge — ERC-1155 stake contract |
| `contracts/test/CBP.t.sol` | Foundry tests for CBP.sol |
| `src/index.ts` | TypeScript verifier SDK (`verifyBCC`) |
| `src/types.ts` | Shared types: `BCCResolution`, `BCCProfile`, `OracleState`, etc. |

### First-time setup (Foundry side)

`contracts/lib/` is gitignored — install dependencies before running tests:

```bash
cd contracts && forge install foundry-rs/forge-std --no-commit
```

---

## Three BCC Profiles

| Profile | Stake medium | Oracle | Open-ended? |
|---------|-------------|--------|-------------|
| `BCC-Capital` | ETH locked in CBP.sol | Contract (on-chain) | No — term required |
| `BCC-Claims` | Resolved predictions (BPTR) | AgentLair oracle | Yes |
| `BCC-Existence` | Attestation days (PoPA) | Self-revealing SCITT chain | Yes |

---

## TS Verifier SDK

```ts
import { verifyBCC } from "@agentlair/bcc-primitive";
import type { BCCResolution } from "@agentlair/bcc-primitive";

// Verify an agent credential (AgentLair-issued)
const result: BCCResolution = await verifyBCC("cred_abc123", {
  source: "agentlair",
});
// → hits https://agentlair.dev/v1/bcc/cred_abc123

// Verify a human/business credential (Commit-issued)
const result2 = await verifyBCC("cred_xyz789", {
  source: "commit",
});
// → hits https://commit-backend.fly.dev/trust/bcc/cred_xyz789
//   normalised to BCCResolution shape; missing fields filled from sane defaults
```

### BCCResolution shape (both verifiers MUST return this)

```ts
{
  credential_id: string;
  valid: boolean;
  profile: "BCC-Capital" | "BCC-Claims" | "BCC-Existence";
  stake: {
    medium: "capital" | "claims" | "existence";
    amount: number | null;
    unit: string | null;
  };
  oracle_state: "active" | "slashed" | "expired" | "self_revealing";
  evidence_chain: Array<{
    type: "scitt_entry" | "onchain_tx";
    ref: string;        // "scitt:<entry_id>" or "0x<tx_hash>"
    timestamp: string;  // ISO 8601 UTC
  }>;
  issuer: string;
  subject: string;
  window: { start: string; end: string | null };
}
```

---

## CBP.sol

```solidity
// Lock ETH → mint bond credential
function lock(uint64 termSeconds, bytes32 subjectId) external payable returns (uint256 bondId);

// Read current state
function readSlashingState(uint256 bondId) external view returns (SlashingState);
// Returns: Active | Slashed | Expired (auto-expires on-chain at term boundary)

// Events
event BondMinted(uint256 indexed bondId, address indexed holder, bytes32 indexed subjectId, uint256 amount, uint64 term);
event BondSlashed(uint256 indexed bondId, string reason, uint256 slashedAmount);
```

### subjectId encoding (NatSpec — contract stores bytes32 opaquely)

| Subject type | Encoding |
|-------------|----------|
| Agent DID | `keccak256("did:web:agentlair.dev:agents:acc_xyz")` |
| World ID nullifier | `keccak256("worldid:0xdeadbeef")` |
| GitHub repo | `keccak256("github_repo:owner/repo")` |
| Brreg business | `keccak256("brreg:123456789")` |
| npm package | `keccak256("npm:@scope/pkg")` |

Callers are responsible for consistent encoding. The contract is subject-agnostic.

### Status

**NOT deployed to mainnet.** Sepolia + Foundry tests only.
Mainnet deploy is a separate task pending security audit.

---

## Running tests

```bash
# TypeScript verifier SDK
bun test

# Solidity contract (requires Foundry)
cd contracts && forge test -vv
```

---

## Repo strategy

Three repos, one primitive:

```
agentlair/bcc-primitive  ← this package (start inside agentlair monorepo)
agentlair-worker         ← agent surface: imports @agentlair/bcc-primitive
hawkaa/commit            ← human/business surface: imports @agentlair/bcc-primitive
```

**Why not monorepo:** prevents the muddle the Commit pivot exposed — two stories, two audiences in one tree.
**Why not duplicate:** copy-paste drift. The BCC schema will evolve; two parallel implementations diverge in 90 days.

License: Apache-2.0
