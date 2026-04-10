/**
 * Approval Flow Example
 *
 * Shows how to use AgentLair's budget approval flow via the SDK:
 *   1. Set a spending cap with on_limit=approve
 *   2. Make a charge that exceeds the cap (→ 202 approval_required)
 *   3. Poll until the principal approves or rejects
 *   4. Approve or reject from the operator side
 *
 * Run: AGENTLAIR_API_KEY=... bun run examples/approval-flow.ts
 *
 * Amount unit: atomic USDC (1e-6). 1 USDC = 1_000_000.
 */

import { AgentLair, AgentLairError } from '../src/index.js';

const KEY = process.env.AGENTLAIR_API_KEY!;
if (!KEY) throw new Error('AGENTLAIR_API_KEY is required');

const lair = new AgentLair(KEY);

// ─── 1. Set budget with on_limit=approve ──────────────────────────────────────
console.log('\n=== 1. Configure budget (on_limit=approve) ===');

const budget = await lair.budget.set({
  daily: 2_000_000,    // 2 USDC daily cap
  weekly: 5_000_000,   // 5 USDC weekly cap
  on_limit: 'approve', // create approval request instead of blocking
});
console.log('Budget configured:', JSON.stringify(budget.caps, null, 2));

// ─── 2. Make a charge that exceeds the daily cap ──────────────────────────────
console.log('\n=== 2. Submit charge (3 USDC > 2 USDC daily cap) ===');

let approvalId: string;

try {
  const charge = await lair.budget.charge({
    amount: 3_000_000,           // 3 USDC — exceeds the 2 USDC daily cap
    category: 'inference',
    description: 'Claude API call — batch job',
    reference_id: 'job_abc123',  // optional: tie to your own request ID
  });

  if (charge.charge_id) {
    // Charge was within budget — no approval needed
    console.log('Charge completed immediately:', charge.charge_id);
    process.exit(0);
  }

  // 202: approval required
  approvalId = charge.approval_id!;
  console.log(`Approval required: ${approvalId}`);
  console.log(`Reason: ${charge.reason}`);         // 'budget_exceeded' | 'single_tx_limit_exceeded'
  console.log(`Expires at: ${charge.expires_at}`); // 24 hours from now
  if (charge.exceeded) {
    for (const e of charge.exceeded) {
      console.log(`  ${e.period}: spent ${e.spent_usdc} / limit ${e.limit_usdc} USDC`);
    }
  }
} catch (e) {
  if (e instanceof AgentLairError && e.status === 402) {
    // on_limit=reject would throw 402 instead of returning 202
    console.error('Charge rejected (budget exceeded, on_limit=reject):', e.message);
    process.exit(1);
  }
  throw e;
}

// ─── 3. Poll until the approval is resolved ───────────────────────────────────
console.log('\n=== 3. Poll for approval status ===');

async function pollApproval(id: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const approval = await lair.budget.getApproval(id);
    console.log(`  status: ${approval.status}`);
    if (approval.status !== 'pending') return approval.status;
    await new Promise(r => setTimeout(r, 2000)); // poll every 2 seconds
  }
  return 'timeout';
}

// In a real agent: block and wait for the principal to decide.
// Here we immediately approve (step 4) so polling resolves right away.

// ─── 4. Approve (or reject) from the operator side ───────────────────────────
console.log('\n=== 4. List pending approvals and approve ===');

// List all pending requests (principal's view)
const list = await lair.budget.approvals('pending');
console.log(`Pending approvals: ${list.count}`);
for (const a of list.approvals) {
  console.log(`  ${a.id}  ${a.amount_usdc} USDC  ${a.description}`);
}

// Approve the request we just created
const approved = await lair.budget.approve(approvalId);
console.log(`Approved: ${approved.ok}  →  charge recorded, spend debited from budget`);

// Alternatively — reject the request:
//
// const rejected = await lair.budget.reject(approvalId, 'exceeds quarterly budget');
// console.log(`Rejected: ${rejected.ok}  →  no spend recorded`);

// ─── 5. Confirm status after approval ─────────────────────────────────────────
console.log('\n=== 5. Confirm final status ===');
const finalStatus = await pollApproval(approvalId, 5_000);
console.log(`Final status: ${finalStatus}`);  // 'approved'

// Check updated budget
const updatedBudget = await lair.budget.get();
console.log('\nUpdated budget:');
for (const [period, info] of Object.entries(updatedBudget.caps)) {
  if (info?.limit_usdc != null) {
    console.log(`  ${period}: ${info.spent_usdc} / ${info.limit_usdc} USDC spent`);
  }
}

console.log('\n✓ Approval flow complete');
