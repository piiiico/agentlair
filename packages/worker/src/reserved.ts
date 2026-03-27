// ─── Reserved Addresses ────────────────────────────────────────────────────────
// System-critical addresses that cannot be claimed by users. Prevents impersonation
// of official communication channels and RFC 2142 required addresses.

export const RESERVED_ADDRESSES = new Set([
  // RFC 2142: required operational mailboxes
  'postmaster', 'abuse', 'hostmaster', 'webmaster',
  // Platform technical addresses — used by mail infrastructure
  'noreply', 'no-reply', 'mailer-daemon', 'null', 'devnull',
  // Platform identity — prevent impersonation of official channels
  'admin', 'administrator', 'support', 'help', 'info', 'contact',
  'billing', 'sales', 'security', 'api', 'system', 'root',
  'team', 'hello', 'hi', 'office', 'service', 'services',
  // Common high-value addresses that should be reserved
  'ceo', 'cto', 'cfo', 'founder', 'legal', 'compliance', 'privacy',
]);

export function isReservedAddress(address: string): boolean {
  if (!address) return false;
  const local = address.split('@')[0].toLowerCase();
  return RESERVED_ADDRESSES.has(local);
}

// Validate local part of an @agentlair.dev address
// Returns null if valid, or an error message string if invalid.
export function validateLocalPart(address: string): string | null {
  if (!address) return 'address required';
  const local = address.split('@')[0];
  if (!local || local.length === 0) return 'Local part cannot be empty.';
  if (local.length > 64) return 'Local part too long (max 64 characters).';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(local)) return 'Local part must start with alphanumeric and contain only letters, digits, dots, hyphens, or underscores.';
  if (/\.\./.test(local)) return 'Local part cannot contain consecutive dots.';
  return null;
}
