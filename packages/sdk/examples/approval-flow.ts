/**
 * Approval Flow Example
 *
 * Shows how to use AgentLair's budget approval flow:
 *   1. Set a spending cap with on_limit=approve
 *   2. Make a charge that exceeds the cap (→ 202 approval_required)
 *   3. Poll until the principal approves or rejects
 *   4. Approve or reject from the operator side
 *
 * Run: AGENTLAIR_API_KEY=... bun run examples/approval-flow.ts
 *
 * Amount unit: atomic USDC (1e-6). 1 USDC = 1_000_000.
 */

const API = 'https://agentlair.dev';
const KEY = process.env.AGENTLAIR_API_KEY!;
if (!KEY) throw new Error('AGENTLAIR_API_KEY is required');

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

// ─── 1. Set budget with on_limit=approve ──────────────────────────────────────
console.log('\n=== 1. Configure budget (on_limit=approve) ===');

const budgetResp = await fetch(`${API}/v1/budget`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    // Flat format: { daily: N } is equivalent to { caps: { daily: N } }
    daily: 2_000_000,    // 2 USDC daily cap
    weekly: 5_000_000,   // 5 USDC weekly cap
    on_limit: 'approve', // create approval request instead of blocking
  }),
});

const budget = await budgetResp.json();
if (!budgetResp.ok) throw new Error(`Budget setup failed: ${JSON.stringify(budget)}`);
console.log('Budget configured:', JSON.stringify(budget.caps, null, 2));

// ─── 2. Make a charge that exceeds the daily cap ──────────────────────────────
console.log('\n=== 2. Submit charge (3 USDC > 2 USDC daily cap) ===');

const chargeResp = await fetch(`${API}/v1/charge`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    amount: 3_000_000,           // 3 USDC — exceeds the 2 USDC daily cap
    category: 'inference',
    description: 'Claude API call — batch job',
    reference_id: 'job_abc123',  // optional: tie to your own request ID
  }),
});

const charge = await chargeResp.json();

if (chargeResp.status === 200) {
  // Charge was within budget — no approval needed
  console.log('Charge completed immediately:', charge.charge_id);
  process.exit(0);
}

if (chargeResp.status === 402) {
  // on_limit=reject would return 402; with approve it returns 202 instead
  console.error('Charge rejected (budget exceeded, on_limit=reject):', charge.message);
  process.exit(1);
}

if (chargeResp.status !== 202) {
  throw new Error(`Unexpected status ${chargeResp.status}: ${JSON.stringify(charge)}`);
}

// 202: approval required
console.log(`Approval required: ${charge.approval_id}`);
console.log(`Reason: ${charge.reason}`);         // 'budget_exceeded' | 'single_tx_limit_exceeded'
console.log(`Expires at: ${charge.expires_at}`); // 24 hours from now
if (charge.exceeded) {
  for (const e of charge.exceeded) {
    console.log(`  ${e.period}: spent ${e.spent_usdc} / limit ${e.limit_usdc} USDC`);
  }
}

// ─── 3. Poll until the approval is resolved ───────────────────────────────────
console.log('\n=== 3. Poll for approval status ===');

async function pollApproval(approvalId: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(`${API}/v1/approvals/${approvalId}`, { headers });
    const approval = await resp.json();
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
const listResp = await fetch(`${API}/v1/approvals?status=pending`, { headers });
const list = await listResp.json();
console.log(`Pending approvals: ${list.count}`);
for (const a of list.approvals) {
  console.log(`  ${a.id}  ${a.amount_usdc} USDC  ${a.description}`);
}

// Approve the request we just created
const approveResp = await fetch(`${API}/v1/approvals/${charge.approval_id}/approve`, {
  method: 'POST',
  headers,
});
const approved = await approveResp.json();
console.log(`Approved: ${approved.ok}  →  charge recorded, spend debited from budget`);

// Alternatively — reject the request:
//
// const rejectResp = await fetch(`${API}/v1/approvals/${charge.approval_id}/reject`, {
//   method: 'POST',
//   headers,
//   body: JSON.stringify({ reason: 'exceeds quarterly budget' }),  // optional
// });
// const rejected = await rejectResp.json();
// console.log(`Rejected: ${rejected.ok}  →  no spend recorded`);

// ─── 5. Confirm status after approval ─────────────────────────────────────────
console.log('\n=== 5. Confirm final status ===');
const finalStatus = await pollApproval(charge.approval_id, 5_000);
console.log(`Final status: ${finalStatus}`);  // 'approved'

// Check updated budget
const budgetCheck = await fetch(`${API}/v1/budget`, { headers });
const updatedBudget = await budgetCheck.json();
console.log('\nUpdated budget:');
for (const [period, info] of Object.entries(updatedBudget.caps as Record<string, Record<string, number>>)) {
  if (info.limit_usdc != null) {
    console.log(`  ${period}: ${info.spent_usdc} / ${info.limit_usdc} USDC spent`);
  }
}

console.log('\n✓ Approval flow complete');
