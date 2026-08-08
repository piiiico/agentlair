/**
 * OAuth Client ID Metadata Documents (CIMD).
 *
 * MCP authorization spec 2026-07-28 deprecates Dynamic Client Registration in
 * favour of CIMD (draft-ietf-oauth-client-id-metadata-document-00): a client
 * uses an HTTPS URL as its `client_id`, and the authorization server fetches
 * that URL to read the client metadata. Primary source re-verified 2026-08-08:
 *
 *   modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
 *   > "Dynamic Client Registration is deprecated. New implementations should
 *   >  use Client ID Metadata Documents instead."
 *
 * AgentLair already hosts a per-agent Ed25519 JWK Set at
 * `/agents/:name/.well-known/jwks.json`. That is exactly the `jwks_uri` a CIMD
 * document needs, so an agent's existing AgentLair identity becomes an MCP
 * client identity with no new key material and no registration call.
 *
 * This module is deliberately pure — no Hono, no KV, no fetch — so the
 * document shape and the spec's MUST-level rules are unit-testable without a
 * deployed worker. index.ts does the KV lookups and calls buildClientMetadata.
 */

/** Canonical origin. See `client_id` note in validateClientMetadata. */
export const CIMD_ISSUER = 'https://agentlair.dev';

/**
 * Properties the spec REQUIRES in the document, verbatim:
 *   "The metadata document MUST include at least the following properties:
 *    `client_id`, `client_name`, `redirect_uris`"
 */
export const CIMD_REQUIRED_PROPERTIES = [
  'client_id',
  'client_name',
  'redirect_uris',
] as const;

export interface ClientMetadataDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  client_uri: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  token_endpoint_auth_signing_alg: string;
  jwks_uri: string;
}

/** The URL this agent's document is served at — and therefore its client_id. */
export function clientIdUrlFor(identifier: string): string {
  return `${CIMD_ISSUER}/agents/${identifier}/client-metadata.json`;
}

/** The per-agent JWK Set route the document points at. */
export function jwksUrlFor(identifier: string): string {
  return `${CIMD_ISSUER}/agents/${identifier}/.well-known/jwks.json`;
}

/**
 * Build the client metadata document for an agent.
 *
 * @param identifier the path segment the document is served under — an agent
 *   name (`picoclaw`) or an account id (`acc_xxx`). `client_id` is built from
 *   this same value, which is what keeps "client_id matches the document URL
 *   exactly" true for both addressing forms.
 * @param displayName human-readable client name shown on the AS consent
 *   screen. Falls back to the identifier when the account has no agent name.
 */
export function buildClientMetadata(
  identifier: string,
  displayName?: string | null,
): ClientMetadataDocument {
  return {
    client_id: clientIdUrlFor(identifier),
    client_name: displayName?.trim() ? displayName.trim() : identifier,
    redirect_uris: [
      // These agents have no browser and no hosted callback. RFC 8252 §7.3
      // (carried into OAuth 2.1) requires the AS to allow an arbitrary port on
      // loopback redirect URIs, so no port is pinned here.
      'http://127.0.0.1/callback',
      'http://localhost/callback',
    ],
    client_uri: `${CIMD_ISSUER}/agents/${identifier}`,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    // The point of the endpoint: the AS authenticates this client with the
    // agent's existing Ed25519 signing key rather than a shared secret.
    // Spec: "Clients MAY use `private_key_jwt` for client authentication
    // (e.g., for requests to the token endpoint) with appropriate JWKS
    // configuration".
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'EdDSA',
    jwks_uri: jwksUrlFor(identifier),
  };
}

export interface CimdValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Check a CIMD document against the spec's MUST-level rules for clients.
 *
 * Written as an independent re-derivation from the spec text rather than a
 * mirror of buildClientMetadata, so it can be pointed at any third party's
 * document — and so it fails if the builder drifts. Each violation quotes the
 * rule it breaks.
 *
 * @param doc parsed JSON document
 * @param documentUrl the URL the document was fetched from
 */
export function validateClientMetadata(
  doc: unknown,
  documentUrl: string,
): CimdValidationResult {
  const violations: string[] = [];

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return {
      valid: false,
      violations: ['document MUST be a JSON object'],
    };
  }
  const d = doc as Record<string, unknown>;

  // "The metadata document MUST include at least the following properties:
  //  client_id, client_name, redirect_uris"
  for (const prop of CIMD_REQUIRED_PROPERTIES) {
    if (!(prop in d)) {
      violations.push(`missing REQUIRED property \`${prop}\``);
    }
  }

  // "Clients MUST ensure the client_id value in the metadata matches the
  //  document URL exactly"
  if (typeof d.client_id !== 'string') {
    if ('client_id' in d) violations.push('`client_id` MUST be a string');
  } else {
    if (d.client_id !== documentUrl) {
      violations.push(
        `\`client_id\` MUST match the document URL exactly (document says "${d.client_id}", fetched from "${documentUrl}")`,
      );
    }
    // "The client_id URL MUST use the "https" scheme and contain a path
    //  component, e.g. https://example.com/client.json"
    let parsed: URL | null = null;
    try {
      parsed = new URL(d.client_id);
    } catch {
      violations.push('`client_id` MUST be a valid absolute URL');
    }
    if (parsed) {
      if (parsed.protocol !== 'https:') {
        violations.push('`client_id` URL MUST use the "https" scheme');
      }
      if (parsed.pathname === '' || parsed.pathname === '/') {
        violations.push('`client_id` URL MUST contain a path component');
      }
    }
  }

  if ('client_name' in d && typeof d.client_name !== 'string') {
    violations.push('`client_name` MUST be a string');
  }

  if ('redirect_uris' in d) {
    if (!Array.isArray(d.redirect_uris)) {
      violations.push('`redirect_uris` MUST be an array');
    } else if (d.redirect_uris.length === 0) {
      violations.push('`redirect_uris` MUST list at least one URI');
    } else if (!d.redirect_uris.every((u) => typeof u === 'string')) {
      violations.push('`redirect_uris` MUST contain only strings');
    }
  }

  // Not a spec MUST, but a document advertising private_key_jwt without a key
  // source cannot be honoured by the AS — the spec conditions private_key_jwt
  // on "appropriate JWKS configuration".
  if (
    d.token_endpoint_auth_method === 'private_key_jwt' &&
    typeof d.jwks_uri !== 'string' &&
    typeof d.jwks !== 'object'
  ) {
    violations.push(
      '`private_key_jwt` requires `jwks_uri` or `jwks` (spec: "with appropriate JWKS configuration")',
    );
  }

  return { valid: violations.length === 0, violations };
}
