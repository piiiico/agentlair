// ─── API Discovery JSON & OpenAPI Spec ────────────────────────────────────────

export const API_DISCOVERY = {
  name: 'AgentLair API',
  version: '0.18.3',
  docs: 'https://agentlair.dev/api',
  status: 'operational',
  endpoints: {
    health: 'GET /health',
    create_key: 'POST /v1/auth/keys',
    rotate_key: 'POST /v1/auth/keys/rotate',
    generate_backup: 'POST /v1/auth/keys/generate-backup',
    activate_backup: 'POST /v1/auth/keys/activate-backup',
    list_keys: 'GET /v1/auth/keys/list',
    provision: 'POST /v1/stack',
    list_stacks: 'GET /v1/stack',
    usage: 'GET /v1/usage',
    get_budget: 'GET /v1/budget',
    set_budget: 'PUT /v1/budget',
    budget_history: 'GET /v1/budget/history?limit={n}&before={ISO}',
    charge: 'POST /v1/charge — declare spending intent (checks budget, creates approval if needed)',
    approvals: 'GET /v1/approvals?status={pending|approved|rejected|expired|all}',
    approve: 'POST /v1/approvals/{id}/approve',
    reject: 'POST /v1/approvals/{id}/reject',
    email: {
      inbox: 'GET /v1/email/inbox?address={addr}&limit={n}',
      read: 'GET /v1/email/messages/{id}?address={addr} — returns { ..., body } normally; when E2E is enabled for the address returns { ..., e2e_encrypted: true, ciphertext: "<base64url>" } instead (client decrypts with private key derived from master seed)',
      update: 'PATCH /v1/email/messages/{id}?address={addr}',
      delete: 'DELETE /v1/email/messages/{id}?address={addr}',
      send: 'POST /v1/email/send',
      outbox: 'GET /v1/email/outbox?limit={n}',
      addresses: 'GET /v1/email/addresses',
      claim: 'POST /v1/email/claim (body: {address, public_key?}) — pass public_key (base64url X25519, 32 bytes) to enable E2E encryption for this address',
      webhooks: {
        register: 'POST /v1/email/webhooks',
        list: 'GET /v1/email/webhooks?address={addr}',
        delete: 'DELETE /v1/email/webhooks/{id}',
      },
    },
    observations: {
      write: 'POST /v1/observations (body: {topic, content, shared?: bool, display_name?: string})',
      read: 'GET /v1/observations?topic={topic}&agent_id={id}&since={ISO}&scope={mine|shared|all}&limit={n}',
      topics: 'GET /v1/observations/topics',
      note: 'Account-scoped by default. Set shared: true to make visible to all agents.',
    },
    e2e: {
      rotate_key: 'POST /v1/e2e/rotate-key (body: {master_seed, new_public_key})',
      note: 'Register or rotate E2E public key. Requires API key auth + master_seed ownership proof. Old keys retained in history so old messages remain decryptable.',
      inbound_encryption: 'Inbound emails are E2E encrypted when the address has a registered public key (via POST /v1/email/claim with public_key). Messages have e2e_encrypted: true and ephemeral_public_key in the response. Client SDK decrypts using X25519 ECDH + HKDF-SHA-256 + AES-256-GCM.',
    },
    vault_legacy: {
      store: 'POST /v1/vault/store (body: {encrypted_seed, recovery_email}) — no auth required (legacy)',
      recover: 'POST /v1/vault/recover (body: {email}) — sends magic link to recovery email',
      verify: 'GET /v1/vault/recover/verify?token=... — returns encrypted_seed blob(s); single-use',
      note: 'Legacy seed recovery flow. Client encrypts seed with passphrase before storing.',
    },
    vault: {
      list: 'GET /v1/vault/ → {keys: [{key, version, metadata, created_at, updated_at}], count, limit}',
      put: 'PUT /v1/vault/{key} (body: {ciphertext: string, metadata?: object}) — store encrypted blob, versioned',
      get: 'GET /v1/vault/{key}?version=N → {key, ciphertext, metadata, version, latest_version, created_at, updated_at}',
      delete: 'DELETE /v1/vault/{key}?version=N — delete all versions (or specific version)',
      recovery_email: 'POST /v1/vault/recovery-email (body: {email, encrypted_seed}) — register recovery email',
      note: 'Zero-knowledge secret store v2. Versioned (append-only), metadata-aware, tier-limited. Client encrypts before storing. Free: 10 keys, 3 versions/key, 16KB max. Paid: unlimited keys, 100 versions/key, 64KB max.',
    },
    credentials: {
      request: 'POST /v1/credentials/request (body: {credential_type, service_name, description?}) — agent requests a credential, returns device_code + user_code',
      approve_get: 'GET /v1/credentials/approve?code=XXXX-XXXX — operator retrieves pending request details',
      approve_post: 'POST /v1/credentials/approve (body: {user_code, approved, credential_value?}) — operator approves or denies credential request',
      poll: 'POST /v1/credentials/poll (body: {device_code}) — agent polls for credential delivery (one-time)',
      note: 'RFC 8628-inspired device flow. Agent requests → operator approves via user code → agent polls to receive credential. TTL: 5 minutes. One-time delivery.',
    },
    trust: {
      score: 'GET /v1/trust/score?agent_id={agentId} — behavioral trust score for an agent (query-param style)',
      profile: 'GET /v1/trust/{agentId} — behavioral trust score for an agent (path-param style)',
    },
  },
  note: 'Beta: email live (inbound + outbound), shared observations live. E2E key rotation live. Vault (encrypted seed storage) live. Credential device flow live. DNS/hosting Q2 2026.',
};

export const OPENAPI_SPEC = {
  "openapi": "3.1.0",
  "info": {
    "title": "AgentLair API",
    "version": "0.18.3",
    "description": "AgentLair is an identity infrastructure layer for AI agents — email inboxes, encrypted secret storage,\nshared observations, and cross-agent coordination. All at your own domain.\n\n## Authentication\nMost endpoints require an API key passed as a Bearer token:\n```\nAuthorization: Bearer al_live_<your_key>\n```\nSession tokens (from magic link login) are also accepted: `Authorization: Bearer session_<token>`\n\n## Rate Limits\nFree tier: 100 API requests/day, 10 emails/day. Paid tier: 10,000/day.\nWhen email limits are exceeded, the API returns HTTP 402 with x402 payment requirements\n(0.01 USDC on Base via the x402 protocol).\n\n## Minimal Payloads\nAppend `?verbose=false` to any request to strip human-readable guidance fields (`message`, `note`, `hint`, `warning`, etc.) from all JSON responses. Only machine-actionable fields are returned. Recommended for agents to reduce token usage.\n",
    "contact": {
      "url": "https://agentlair.dev"
    },
    "license": {
      "name": "Proprietary"
    }
  },
  "servers": [
    {
      "url": "https://agentlair.dev",
      "description": "Production"
    }
  ],
  "tags": [
    {
      "name": "health",
      "description": "Service health"
    },
    {
      "name": "auth",
      "description": "API key creation, rotation, and magic link authentication"
    },
    {
      "name": "account",
      "description": "Account management"
    },
    {
      "name": "email",
      "description": "Email inboxes — claim addresses, read inbox, send, webhooks"
    },
    {
      "name": "inbox",
      "description": "Alternative inbox API (v0.2 style)"
    },
    {
      "name": "observations",
      "description": "Shared key-value observations for agent coordination"
    },
    {
      "name": "vault",
      "description": "Zero-knowledge encrypted secret storage (versioned)"
    },
    {
      "name": "vault-legacy",
      "description": "Legacy encrypted seed storage (no auth required)"
    },
    {
      "name": "stack",
      "description": "Domain stack provisioning"
    },
    {
      "name": "billing",
      "description": "Usage and billing information"
    },
    {
      "name": "budget",
      "description": "Per-agent spending caps, charge declaration, and approval flow"
    },
    {
      "name": "e2e",
      "description": "End-to-end encryption key management"
    },
    {
      "name": "pods",
      "description": "Multi-tenant pod management for platform builders"
    },
    {
      "name": "calendar",
      "description": "Agent-owned calendar — events and iCal feed"
    },
    {
      "name": "websocket",
      "description": "Real-time inbox notifications over WebSocket"
    },
    {
      "name": "agent-profiles",
      "description": "Content-negotiated agent identity pages"
    },
    {
      "name": "credentials",
      "description": "RFC 8628-inspired device flow for agents to request credentials from operators"
    },
    {
      "name": "trust",
      "description": "Behavioral trust scores for agents"
    }
  ],
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "al_live_<key> or session_<token>"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string",
            "description": "Machine-readable error code"
          },
          "message": {
            "type": "string",
            "description": "Human-readable error description"
          }
        },
        "required": [
          "error"
        ],
        "example": {
          "error": "unauthorized",
          "message": "Authentication required. Pass API key as: Authorization: Bearer al_live_..."
        }
      },
      "Account": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "example": "acc_k7x9m2p4abcd1234"
          },
          "key_prefix": {
            "type": "string",
            "example": "al_live_k7x9"
          },
          "name": {
            "type": "string",
            "example": "default"
          },
          "tier": {
            "type": "string",
            "enum": [
              "free",
              "paid"
            ]
          },
          "recovery_email": {
            "type": "string",
            "format": "email",
            "nullable": true
          },
          "email": {
            "type": "string",
            "format": "email",
            "nullable": true
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "ApiKey": {
        "type": "object",
        "properties": {
          "api_key": {
            "type": "string",
            "description": "Full API key — save immediately, not shown again",
            "example": "al_live_k7x9m2p4abcdefghijklmnopqrstuvwxyz12"
          },
          "key_prefix": {
            "type": "string",
            "example": "al_live_k7x9"
          },
          "account_id": {
            "type": "string"
          },
          "tier": {
            "type": "string",
            "enum": [
              "free",
              "paid"
            ]
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "warning": {
            "type": "string"
          },
          "limits": {
            "type": "object",
            "properties": {
              "stacks": {
                "type": "integer"
              },
              "addresses": {
                "type": "integer"
              },
              "dns_records": {
                "type": "integer"
              },
              "emails_per_day": {
                "type": "integer"
              },
              "requests_per_day": {
                "type": "integer"
              }
            }
          }
        }
      },
      "EmailMessage": {
        "type": "object",
        "properties": {
          "message_id": {
            "type": "string"
          },
          "from": {
            "type": "string"
          },
          "to": {
            "type": "string"
          },
          "subject": {
            "type": "string"
          },
          "snippet": {
            "type": "string",
            "description": "First 120 characters of message body (list view)"
          },
          "received_at": {
            "type": "string",
            "format": "date-time"
          },
          "read": {
            "type": "boolean"
          },
          "archived": {
            "type": "boolean",
            "description": "Whether the message has been archived (default false)"
          },
          "e2e_encrypted": {
            "type": "boolean",
            "description": "Present and true when address has E2E key registered"
          }
        }
      },
      "EmailMessageFull": {
        "allOf": [
          {
            "$ref": "#/components/schemas/EmailMessage"
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string",
                "description": "Decrypted body (plaintext) or base64url ciphertext if e2e_encrypted"
              },
              "ephemeral_public_key": {
                "type": "string",
                "description": "Present when e2e_encrypted=true, used for ECDH decryption"
              }
            }
          }
        ]
      },
      "VaultEntry": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string"
          },
          "ciphertext": {
            "type": "string",
            "description": "Encrypted blob — AgentLair never sees plaintext"
          },
          "metadata": {
            "type": "object",
            "nullable": true
          },
          "version": {
            "type": "integer"
          },
          "latest_version": {
            "type": "integer"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Observation": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "agent_id": {
            "type": "string",
            "description": "Bound to authenticated account — prevents impersonation"
          },
          "display_name": {
            "type": "string",
            "nullable": true
          },
          "topic": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "shared": {
            "type": "boolean"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "Webhook": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "example": "wh_abc123def456ghi7"
          },
          "address": {
            "type": "string",
            "example": "myagent@agentlair.dev"
          },
          "url": {
            "type": "string",
            "format": "uri"
          },
          "has_secret": {
            "type": "boolean"
          },
          "events": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "example": [
              "email.received"
            ]
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "SpendingCaps": {
        "type": "object",
        "description": "Atomic USDC spending caps per calendar period (UTC). 1 USDC = 1,000,000 atomic units. Values must be positive integers with daily ≤ weekly ≤ monthly.",
        "properties": {
          "daily": {
            "type": "integer",
            "description": "Maximum atomic USDC per calendar day (UTC)",
            "example": 1000000
          },
          "weekly": {
            "type": "integer",
            "description": "Maximum atomic USDC per ISO calendar week (UTC)",
            "example": 5000000
          },
          "monthly": {
            "type": "integer",
            "description": "Maximum atomic USDC per calendar month (UTC)",
            "example": 20000000
          }
        }
      },
      "PodRateLimits": {
        "type": "object",
        "description": "Request rate limits for a pod. Values must be positive integers with requests_per_minute ≤ requests_per_hour ≤ requests_per_day.",
        "properties": {
          "requests_per_minute": {
            "type": "integer",
            "description": "Maximum requests per minute",
            "example": 60
          },
          "requests_per_hour": {
            "type": "integer",
            "description": "Maximum requests per hour",
            "example": 1000
          },
          "requests_per_day": {
            "type": "integer",
            "description": "Maximum requests per day",
            "example": 10000
          }
        }
      },
      "Pod": {
        "type": "object",
        "properties": {
          "pod_id": {
            "type": "string",
            "example": "pod_abc123def456"
          },
          "name": {
            "type": "string",
            "nullable": true,
            "example": "my-app"
          },
          "status": {
            "type": "string",
            "enum": [
              "active",
              "suspended"
            ]
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "parent_account_id": {
            "type": "string"
          },
          "rate_limits": {
            "nullable": true,
            "allOf": [
              { "$ref": "#/components/schemas/PodRateLimits" }
            ],
            "description": "Request rate limits for this pod, or null if not set"
          },
          "spending_caps": {
            "nullable": true,
            "allOf": [
              { "$ref": "#/components/schemas/SpendingCaps" }
            ],
            "description": "Atomic USDC spending caps for this pod, or null if not set"
          }
        }
      },
      "CalEvent": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "example": "evt_abc123def456"
          },
          "summary": {
            "type": "string",
            "example": "Team sync"
          },
          "start": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 datetime"
          },
          "end": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 datetime"
          },
          "description": {
            "type": "string",
            "nullable": true
          },
          "location": {
            "type": "string",
            "nullable": true
          },
          "attendees": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "example": [
              "alice@example.com",
              "bob@example.com"
            ]
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    }
  },
  "security": [
    {
      "bearerAuth": []
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "health"
        ],
        "summary": "Health check",
        "security": [],
        "responses": {
          "200": {
            "description": "Service is healthy",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "example": "ok"
                    },
                    "timestamp": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "version": {
                      "type": "string",
                      "example": "0.18.3"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api": {
      "get": {
        "tags": [
          "health"
        ],
        "summary": "OpenAPI spec (this document)",
        "security": [],
        "responses": {
          "200": {
            "description": "OpenAPI 3.1 specification",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/keys": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Create API key",
        "description": "Create a new account and API key. No authentication required.\nRate limited to 5 key creations per IP per hour.\nThe returned `api_key` is shown **only once** — save it immediately.\n",
        "security": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Optional label for the key",
                    "example": "my-agent"
                  },
                  "email": {
                    "type": "string",
                    "format": "email",
                    "description": "Optional recovery email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "API key created",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiKey"
                }
              }
            }
          },
          "429": {
            "description": "Rate limited",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/keys": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Create API key (alias)",
        "description": "Alias for `POST /v1/auth/keys`. Returns a slightly different response shape.",
        "security": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "API key created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "key": {
                      "type": "string",
                      "description": "Full API key — save immediately"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "description": "Rate limited"
          }
        }
      }
    },
    "/v1/auth/login": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Request magic link",
        "description": "Send a magic link to a registered recovery email.\nThe link expires in 15 minutes and is single-use.\nSame response is returned whether or not the email is registered (avoids enumeration).\n",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Magic link sent (or silently no-op if email not registered)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sent": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid email",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/verify": {
      "get": {
        "tags": [
          "auth"
        ],
        "summary": "Verify magic link",
        "description": "Verify a magic link token. On success, creates a 24-hour session and\nredirects to `/dashboard#session=<token>`.\n",
        "security": [],
        "parameters": [
          {
            "name": "token",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "302": {
            "description": "Redirect to dashboard with session token in fragment"
          },
          "400": {
            "description": "Invalid or expired token"
          }
        }
      }
    },
    "/v1/auth/keys/rotate": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Rotate API key",
        "description": "Generate a new API key for this account. The old key is immediately invalidated.\nRequires authentication (API key or session).\n",
        "responses": {
          "200": {
            "description": "New key generated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "api_key": {
                      "type": "string",
                      "description": "New API key — save immediately"
                    },
                    "key_prefix": {
                      "type": "string"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "rotated_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "warning": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/v1/auth/keys/generate-backup": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Generate backup key",
        "description": "Create a backup key (dormant until activated). Max 1 backup key at a time.\nActivate with `POST /v1/auth/keys/activate-backup`.\n",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "label": {
                    "type": "string",
                    "default": "backup"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Backup key generated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "backup_key": {
                      "type": "string",
                      "description": "Backup key — save securely, not shown again"
                    },
                    "key_prefix": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "example": "backup"
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "warning": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "409": {
            "description": "A backup key already exists"
          }
        }
      }
    },
    "/v1/auth/keys/activate-backup": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Activate backup key",
        "description": "Promote the backup key to active primary. The current primary key is revoked.\n",
        "responses": {
          "200": {
            "description": "Backup key activated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "activated_key_prefix": {
                      "type": "string"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "activated_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "No backup key found"
          }
        }
      }
    },
    "/v1/auth/keys/list": {
      "get": {
        "tags": [
          "auth"
        ],
        "summary": "List API keys",
        "description": "List all keys for the account with their status (active, backup, revoked).",
        "responses": {
          "200": {
            "description": "Keys list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "account_id": {
                      "type": "string"
                    },
                    "keys": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "prefix": {
                            "type": "string"
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "active",
                              "backup",
                              "revoked"
                            ]
                          },
                          "label": {
                            "type": "string",
                            "nullable": true
                          },
                          "created_at": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "activated_at": {
                            "type": "string",
                            "format": "date-time",
                            "nullable": true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/account/me": {
      "get": {
        "tags": [
          "account"
        ],
        "summary": "Get account info",
        "responses": {
          "200": {
            "description": "Current account details",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Account"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          }
        }
      }
    },
    "/v1/account/recovery-email": {
      "post": {
        "tags": [
          "account"
        ],
        "summary": "Set recovery email",
        "description": "Set or update the recovery email for dashboard magic-link login.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Recovery email updated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    },
                    "recovery_email": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid email"
          }
        }
      }
    },
    "/v1/account/operator-email": {
      "post": {
        "tags": [
          "account"
        ],
        "summary": "Set operator email",
        "description": "Set or update the operator notification email for the account. Pod keys are blocked (403 pod_auth_forbidden).",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Operator email updated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    },
                    "operator_email": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid email"
          },
          "403": {
            "description": "Pod keys not allowed (pod_auth_forbidden)"
          }
        },
        "security": [
          {
            "BearerAuth": []
          }
        ]
      }
    },
    "/v1/e2e/rotate-key": {
      "post": {
        "tags": [
          "e2e"
        ],
        "summary": "Register or rotate E2E public key",
        "description": "Register or rotate the X25519 E2E public key for this account.\nOn first call: sets `master_seed` hash and initial public key.\nOn subsequent calls: verifies `master_seed` matches stored hash, then rotates.\nOld keys are retained in history so old encrypted messages remain decryptable.\n\nWhen an `@agentlair.dev` address has a registered public key (via `POST /v1/email/claim`\nwith `public_key`), inbound emails are encrypted with X25519 ECDH + AES-256-GCM.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "master_seed",
                  "new_public_key"
                ],
                "properties": {
                  "master_seed": {
                    "type": "string",
                    "description": "Ownership proof — SHA-256 hash stored server-side"
                  },
                  "new_public_key": {
                    "type": "string",
                    "description": "Base64 or hex encoded X25519 public key (32 bytes)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "E2E key registered or rotated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "active_public_key": {
                      "type": "string"
                    },
                    "key_history_count": {
                      "type": "integer"
                    },
                    "first_setup": {
                      "type": "boolean"
                    },
                    "updated_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "master_seed does not match"
          }
        }
      }
    },
    "/v1/stack": {
      "post": {
        "tags": [
          "stack"
        ],
        "summary": "Create domain stack",
        "description": "Provision a stack for your domain. Points nameservers to AgentLair DNS.\nBeta: DNS provisioning is stubbed. Full CF DNS integration coming Q2 2026.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "domain"
                ],
                "properties": {
                  "domain": {
                    "type": "string",
                    "example": "myagent.dev"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Stack created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "domain": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "example": "provisioning"
                    },
                    "nameservers": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "next_steps": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          },
          "402": {
            "description": "Upgrade required (free tier allows 1 stack)"
          }
        }
      },
      "get": {
        "tags": [
          "stack"
        ],
        "summary": "List stacks",
        "responses": {
          "200": {
            "description": "List of stacks",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "stacks": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          }
                        }
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/usage": {
      "get": {
        "tags": [
          "billing"
        ],
        "summary": "Get usage stats",
        "responses": {
          "200": {
            "description": "Current usage",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "account_id": {
                      "type": "string"
                    },
                    "tier": {
                      "type": "string"
                    },
                    "period": {
                      "type": "string",
                      "description": "Date (YYYY-MM-DD)"
                    },
                    "requests": {
                      "type": "object",
                      "properties": {
                        "used": {
                          "type": "integer"
                        },
                        "limit": {
                          "type": "integer"
                        }
                      }
                    },
                    "stacks": {
                      "type": "object",
                      "properties": {
                        "used": {
                          "type": "integer"
                        },
                        "limit": {
                          "type": "integer"
                        }
                      }
                    },
                    "emails": {
                      "type": "object",
                      "properties": {
                        "daily_used": {
                          "type": "integer"
                        },
                        "daily_limit": {
                          "type": "integer"
                        },
                        "daily_remaining": {
                          "type": "integer"
                        },
                        "hourly_limit": {
                          "type": "integer"
                        },
                        "reset_at": {
                          "type": "string",
                          "format": "date-time"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/billing": {
      "get": {
        "tags": [
          "billing"
        ],
        "summary": "Get billing info",
        "description": "Returns plan details and x402 payment configuration.\nWhen email rate limits are hit, the API returns HTTP 402 with x402 payment headers.\nSend `X-PAYMENT` header with a base64-encoded payment payload to bypass limits\n(0.01 USDC on Base).\n",
        "responses": {
          "200": {
            "description": "Billing info",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "account_id": {
                      "type": "string"
                    },
                    "tier": {
                      "type": "string"
                    },
                    "plan": {
                      "type": "string"
                    },
                    "x402": {
                      "type": "object",
                      "properties": {
                        "supported": {
                          "type": "boolean"
                        },
                        "network": {
                          "type": "string"
                        },
                        "asset": {
                          "type": "string"
                        },
                        "email_price": {
                          "type": "string",
                          "example": "0.01 USDC"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/budget": {
      "get": {
        "tags": [
          "budget"
        ],
        "summary": "Get spending caps",
        "description": "Returns current spending caps and remaining budget for the authenticated account.\nAmounts are in atomic USDC units (6 decimals). 1,000,000 = 1.00 USDC.\n",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Current budget caps and status",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "agent_id": {
                      "type": "string"
                    },
                    "currency": {
                      "type": "string",
                      "example": "USDC"
                    },
                    "atomic_unit": {
                      "type": "string",
                      "example": "1e-6 USDC (one millionth of one USDC)"
                    },
                    "caps": {
                      "type": "object",
                      "description": "Per-period spending caps. Each period is null (no cap) or a cap object.",
                      "properties": {
                        "daily": {
                          "nullable": true,
                          "oneOf": [
                            {
                              "type": "object",
                              "properties": {
                                "limit_usdc": { "type": "integer" },
                                "spent_usdc": { "type": "integer" },
                                "remaining_usdc": { "type": "integer" },
                                "resets_at": { "type": "string", "format": "date-time" }
                              }
                            }
                          ]
                        },
                        "weekly": {
                          "nullable": true,
                          "oneOf": [
                            {
                              "type": "object",
                              "properties": {
                                "limit_usdc": { "type": "integer" },
                                "spent_usdc": { "type": "integer" },
                                "remaining_usdc": { "type": "integer" },
                                "resets_at": { "type": "string", "format": "date-time" }
                              }
                            }
                          ]
                        },
                        "monthly": {
                          "nullable": true,
                          "oneOf": [
                            {
                              "type": "object",
                              "properties": {
                                "limit_usdc": { "type": "integer" },
                                "spent_usdc": { "type": "integer" },
                                "remaining_usdc": { "type": "integer" },
                                "resets_at": { "type": "string", "format": "date-time" }
                              }
                            }
                          ]
                        }
                      }
                    },
                    "has_caps": {
                      "type": "boolean"
                    },
                    "status": {
                      "type": "string",
                      "enum": ["active", "limit_reached"]
                    },
                    "settings": {
                      "type": "object",
                      "properties": {
                        "on_limit": {
                          "type": "string",
                          "enum": ["reject", "approve"]
                        },
                        "single_tx_limit_cents": {
                          "type": "integer",
                          "nullable": true
                        }
                      }
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "tags": [
          "budget"
        ],
        "summary": "Set spending caps",
        "description": "Set or update per-period spending caps for the authenticated account.\nAt least one of `caps`, `on_limit`, or `single_tx_limit_cents` must be provided.\nCap amounts are in atomic USDC units (1,000,000 = 1.00 USDC).\nOrdering constraint: daily ≤ weekly ≤ monthly.\n\n**Flat format supported:** You can pass `daily`, `weekly`, `monthly` at the top level without wrapping in a `caps` object:\n```json\n{\"daily\": 10000000, \"on_limit\": \"approve\"}\n```\n\n**on_limit=approve:** When set, charges exceeding the cap return HTTP 202 with an `approval_id` instead of 402.\nThe principal can then approve or reject via `POST /v1/approvals/{id}/approve` or `/reject`.\n",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "daily": {
                    "nullable": true,
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000000000,
                    "description": "Daily cap in atomic USDC units (flat format). Alternative to caps.daily.",
                    "example": 10000000
                  },
                  "weekly": {
                    "nullable": true,
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000000000,
                    "description": "Weekly cap in atomic USDC units (flat format). Alternative to caps.weekly.",
                    "example": 50000000
                  },
                  "monthly": {
                    "nullable": true,
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000000000,
                    "description": "Monthly cap in atomic USDC units (flat format). Alternative to caps.monthly.",
                    "example": 100000000
                  },
                  "caps": {
                    "type": "object",
                    "description": "Per-period cap amounts (nested format). Pass null for a period to remove that cap.",
                    "properties": {
                      "daily": {
                        "nullable": true,
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 1000000000,
                        "example": 1000000
                      },
                      "weekly": {
                        "nullable": true,
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 1000000000,
                        "example": 5000000
                      },
                      "monthly": {
                        "nullable": true,
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 1000000000,
                        "example": 20000000
                      }
                    }
                  },
                  "on_limit": {
                    "type": "string",
                    "enum": ["reject", "approve"],
                    "description": "Action when spending cap is reached. 'reject' (default) returns 402; 'approve' returns 202 with an approval_id for the principal to act on."
                  },
                  "single_tx_limit_cents": {
                    "nullable": true,
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000000000,
                    "description": "Maximum allowed single-transaction amount in atomic USDC units. Null to remove. Charges above this limit trigger the approval flow even if within period budget."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated spending caps",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    },
                    "agent_id": {
                      "type": "string"
                    },
                    "caps": {
                      "type": "object",
                      "description": "Updated cap state for each modified period"
                    },
                    "settings": {
                      "type": "object",
                      "properties": {
                        "on_limit": {
                          "type": "string",
                          "enum": ["reject", "approve"]
                        },
                        "single_tx_limit_cents": {
                          "type": "integer",
                          "nullable": true
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/budget/history": {
      "get": {
        "tags": [
          "budget"
        ],
        "summary": "Get spending history",
        "description": "Returns paginated spend history from the ledger for the authenticated account.\nEntries are returned newest-first. Use `before` for cursor-based pagination.\nAmounts are in atomic USDC units (1,000,000 = 1.00 USDC).\n",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50,
              "minimum": 1,
              "maximum": 200
            },
            "description": "Number of entries to return (default 50, max 200)"
          },
          {
            "name": "before",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            },
            "description": "ISO timestamp cursor for pagination — returns entries before this timestamp"
          }
        ],
        "responses": {
          "200": {
            "description": "Spending history",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "agent_id": {
                      "type": "string"
                    },
                    "currency": {
                      "type": "string",
                      "example": "USDC"
                    },
                    "atomic_unit": {
                      "type": "string",
                      "example": "1e-6 USDC (one millionth of one USDC)"
                    },
                    "entries": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "timestamp": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "amount_usdc": {
                            "type": "integer"
                          },
                          "category": {
                            "type": "string"
                          },
                          "description": {
                            "type": "string"
                          },
                          "reference_id": {
                            "type": "string",
                            "nullable": true
                          }
                        }
                      }
                    },
                    "summary": {
                      "type": "object",
                      "properties": {
                        "count": {
                          "type": "integer"
                        },
                        "total_usdc": {
                          "type": "integer"
                        },
                        "by_category": {
                          "type": "object",
                          "additionalProperties": {
                            "type": "integer"
                          }
                        }
                      }
                    },
                    "pagination": {
                      "type": "object",
                      "properties": {
                        "limit": {
                          "type": "integer"
                        },
                        "has_more": {
                          "type": "boolean"
                        },
                        "next_before": {
                          "type": "string",
                          "nullable": true,
                          "format": "date-time"
                        }
                      }
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/charge": {
      "post": {
        "tags": ["budget"],
        "summary": "Declare spending intent",
        "description": "Declare intent to spend. If within budget, records spend immediately and returns completed status. If over budget and on_limit=approve, creates an approval request (202). If over budget and on_limit=reject, returns 402.",
        "security": [{ "bearerAuth": [] }],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["amount"],
                "properties": {
                  "amount": { "type": "integer", "description": "Amount in atomic USDC units (1,000,000 = 1.00 USDC)", "minimum": 1 },
                  "category": { "type": "string", "description": "Spend category", "default": "platform" },
                  "description": { "type": "string", "description": "Human-readable description" },
                  "reference_id": { "type": "string", "description": "External reference ID" },
                  "metadata": { "type": "object", "description": "Arbitrary metadata stored with approval request" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Charge completed (within budget)" },
          "202": { "description": "Approval required (over budget, on_limit=approve)" },
          "402": { "description": "Budget exceeded (on_limit=reject)" },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/v1/approvals": {
      "get": {
        "tags": ["budget"],
        "summary": "List approval requests",
        "description": "List pending (or resolved) approval requests for the authenticated account.",
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          { "name": "status", "in": "query", "schema": { "type": "string", "enum": ["pending", "approved", "rejected", "expired", "all"], "default": "pending" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50, "maximum": 200 } }
        ],
        "responses": {
          "200": { "description": "List of approval requests" },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/v1/approvals/{id}": {
      "get": {
        "tags": ["budget"],
        "summary": "Get single approval request",
        "description": "Returns full detail for a single approval request. Automatically marks as expired if past expiry.",
        "security": [{ "bearerAuth": [] }],
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "example": "apr_abc123" } }],
        "responses": {
          "200": {
            "description": "Approval request detail",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": { "type": "string", "example": "apr_abc123" },
                    "account_id": { "type": "string" },
                    "amount_usdc": { "type": "integer", "description": "Amount in atomic USDC units" },
                    "category": { "type": "string" },
                    "description": { "type": "string" },
                    "reference_id": { "type": "string", "nullable": true },
                    "status": { "type": "string", "enum": ["pending", "approved", "rejected", "expired"] },
                    "created_at": { "type": "string", "format": "date-time" },
                    "resolved_at": { "type": "string", "format": "date-time", "nullable": true },
                    "resolved_by": { "type": "string", "nullable": true },
                    "expires_at": { "type": "string", "format": "date-time" },
                    "metadata": { "type": "object", "nullable": true }
                  }
                }
              }
            }
          },
          "404": { "description": "Not found" },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/v1/approvals/{id}/approve": {
      "post": {
        "tags": ["budget"],
        "summary": "Approve a charge request",
        "description": "Approve a pending charge request. Records the spend to the budget ledger.",
        "security": [{ "bearerAuth": [] }],
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": {
          "200": { "description": "Approved successfully" },
          "404": { "description": "Not found" },
          "409": { "description": "Already resolved" },
          "410": { "description": "Expired" }
        }
      }
    },
    "/v1/approvals/{id}/reject": {
      "post": {
        "tags": ["budget"],
        "summary": "Reject a charge request",
        "description": "Reject a pending charge request. No spend is recorded.",
        "security": [{ "bearerAuth": [] }],
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "reason": { "type": "string", "description": "Optional rejection reason" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Rejected successfully" },
          "404": { "description": "Not found" },
          "409": { "description": "Already resolved" },
          "410": { "description": "Expired" }
        }
      }
    },
    "/v1/email/claim": {
      "post": {
        "tags": [
          "email"
        ],
        "summary": "Claim email address",
        "description": "Explicitly claim an `@agentlair.dev` address for this account before emails arrive.\nOptionally provide an X25519 `public_key` (base64url, 32 bytes) to enable E2E encryption:\ninbound emails will be encrypted and only decryptable by the holder of the matching\nprivate key.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "address"
                ],
                "properties": {
                  "address": {
                    "type": "string",
                    "example": "myagent@agentlair.dev"
                  },
                  "public_key": {
                    "type": "string",
                    "description": "Optional. Base64url-encoded X25519 public key (32 bytes) to enable E2E encryption"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Address claimed",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "address": {
                      "type": "string"
                    },
                    "claimed": {
                      "type": "boolean"
                    },
                    "already_owned": {
                      "type": "boolean"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "e2e_enabled": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid address"
          },
          "403": {
            "description": "Address reserved or limit reached"
          },
          "409": {
            "description": "Address claimed by another account"
          }
        }
      }
    },
    "/v1/email/addresses": {
      "get": {
        "tags": [
          "email"
        ],
        "summary": "List claimed addresses",
        "description": "List all `@agentlair.dev` addresses owned by this account.",
        "responses": {
          "200": {
            "description": "Addresses list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "addresses": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/email/inbox": {
      "get": {
        "tags": [
          "email"
        ],
        "summary": "Read inbox",
        "description": "List messages for an `@agentlair.dev` address.\n**Auto-claims the address on first access** (respects per-tier limits).\nReturns message snippets (first 120 chars). Use `GET /v1/email/messages/{id}` for full body.\n",
        "parameters": [
          {
            "name": "address",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "myagent@agentlair.dev"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20,
              "maximum": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Messages list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "messages": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/EmailMessage"
                      }
                    },
                    "has_more": {
                      "type": "boolean"
                    },
                    "count": {
                      "type": "integer"
                    },
                    "address": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Address belongs to another account"
          }
        }
      }
    },
    "/v1/email/messages/{id}": {
      "get": {
        "tags": [
          "email"
        ],
        "summary": "Get message",
        "description": "Retrieve and mark a message as read.\n- If E2E encryption is disabled: returns decrypted `body` (string).\n- If E2E encryption is enabled: returns `body` (ciphertext, base64url),\n  `ephemeral_public_key`, and `e2e_encrypted: true`. Decrypt client-side using\n  X25519 ECDH + HKDF-SHA-256 + AES-256-GCM.\n",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "URL-encoded message ID"
          },
          {
            "name": "address",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Full message",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/EmailMessageFull"
                }
              }
            }
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Message not found"
          }
        }
      },
      "delete": {
        "tags": [
          "email"
        ],
        "summary": "Delete message",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "address",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Message deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "deleted": {
                      "type": "boolean"
                    },
                    "message_id": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Not found"
          }
        }
      },
      "patch": {
        "tags": [
          "email"
        ],
        "summary": "Update message",
        "description": "Update message properties (e.g., mark read/unread).",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "address",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "read": {
                    "type": "boolean"
                  },
                  "archived": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Message updated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "updated": {
                      "type": "boolean"
                    },
                    "message_id": {
                      "type": "string"
                    },
                    "read": {
                      "type": "boolean"
                    },
                    "archived": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/email/outbox": {
      "get": {
        "tags": [
          "email"
        ],
        "summary": "List sent messages",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20,
              "maximum": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Outbox messages",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "messages": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "from": {
                            "type": "string"
                          },
                          "to": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "subject": {
                            "type": "string"
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "pending",
                              "sent",
                              "failed"
                            ]
                          },
                          "queued_at": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "sent_at": {
                            "type": "string",
                            "format": "date-time",
                            "nullable": true
                          },
                          "error": {
                            "type": "string",
                            "nullable": true
                          }
                        }
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/email/send": {
      "post": {
        "tags": [
          "email"
        ],
        "summary": "Send email",
        "description": "Send an email from an `@agentlair.dev` address you own.\nFree tier: 10 emails/day, 10 recipients/send.\nPaid tier: 50 recipients/send, higher limits.\n\nWhen rate limited, returns HTTP 402 with x402 payment requirements.\nInclude `X-PAYMENT` header with a valid payment to bypass limits (0.01 USDC on Base).\n\n**Intra-domain delivery:** When sending to another `@agentlair.dev` address, delivery is internal (no external SMTP/Resend). Response includes `provider: \"internal\"` and `internal_recipients` array. Received messages have `auth.method: \"internal\"`.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "from",
                  "to",
                  "subject"
                ],
                "properties": {
                  "from": {
                    "type": "string",
                    "description": "Must be an @agentlair.dev address you own",
                    "example": "myagent@agentlair.dev"
                  },
                  "to": {
                    "oneOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ],
                    "example": "recipient@example.com"
                  },
                  "subject": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string",
                    "description": "Plain text body (text or html required)"
                  },
                  "html": {
                    "type": "string",
                    "description": "HTML body"
                  },
                  "in_reply_to": {
                    "type": "string",
                    "description": "Message-ID of message being replied to"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Email sent",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "provider_id": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "example": "sent"
                    },
                    "from": {
                      "type": "string"
                    },
                    "to": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "sent_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "provider": {
                      "type": "string",
                      "description": "Delivery provider used. 'internal' when all recipients are @agentlair.dev addresses (no external SMTP).",
                      "example": "resend"
                    },
                    "internal_recipients": {
                      "type": "array",
                      "description": "Present when at least one recipient is an @agentlair.dev address. Each entry shows whether internal delivery succeeded.",
                      "items": {
                        "type": "object",
                        "properties": {
                          "address": {
                            "type": "string"
                          },
                          "delivered": {
                            "type": "boolean"
                          },
                          "error": {
                            "type": "string"
                          }
                        }
                      }
                    },
                    "rate_limit": {
                      "type": "object",
                      "properties": {
                        "daily_remaining": {
                          "type": "integer"
                        },
                        "hourly_remaining": {
                          "type": "integer"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Missing or invalid fields"
          },
          "402": {
            "description": "Rate limited — x402 payment required",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "string"
                    },
                    "accepts": {
                      "type": "array"
                    },
                    "rate_limit": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Sender address not owned or suspended"
          }
        }
      }
    },
    "/v1/email/webhooks": {
      "post": {
        "tags": [
          "email"
        ],
        "summary": "Register webhook",
        "description": "Register a webhook URL to receive real-time `email.received` events.\nAgentLair will POST a JSON payload to your URL within seconds of inbound delivery.\n\nIf `secret` is provided, requests include `X-AgentLair-Signature: sha256=<hmac-sha256-hex-of-json-body>`.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "address",
                  "url"
                ],
                "properties": {
                  "address": {
                    "type": "string",
                    "example": "myagent@agentlair.dev"
                  },
                  "url": {
                    "type": "string",
                    "format": "uri",
                    "example": "https://myserver.com/webhook"
                  },
                  "secret": {
                    "type": "string",
                    "description": "Optional HMAC secret for signature verification"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Webhook registered",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Webhook"
                }
              }
            }
          },
          "400": {
            "description": "Invalid parameters"
          }
        }
      },
      "get": {
        "tags": [
          "email"
        ],
        "summary": "List webhooks",
        "parameters": [
          {
            "name": "address",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Filter by address"
          }
        ],
        "responses": {
          "200": {
            "description": "Webhooks list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "webhooks": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Webhook"
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/email/webhooks/{id}": {
      "delete": {
        "tags": [
          "email"
        ],
        "summary": "Delete webhook",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Webhook deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "deleted": {
                      "type": "boolean"
                    },
                    "id": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "description": "Not your webhook"
          },
          "404": {
            "description": "Not found"
          }
        }
      }
    },
    "/v1/inbox": {
      "post": {
        "tags": [
          "inbox"
        ],
        "summary": "Create inbox",
        "description": "Create (claim) an `@agentlair.dev` inbox. Provide a `name` for a human-readable address\nor omit for a random slug.\n",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Local part of the address (e.g., \"alice\" → alice@agentlair.dev)",
                    "example": "alice"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Inbox created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "address": {
                      "type": "string"
                    },
                    "created": {
                      "type": "boolean"
                    },
                    "already_owned": {
                      "type": "boolean"
                    },
                    "account_id": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "409": {
            "description": "Address taken by another account"
          }
        }
      }
    },
    "/v1/inbox/{address}": {
      "get": {
        "tags": [
          "inbox"
        ],
        "summary": "List inbox messages",
        "description": "List messages for the inbox. Auto-claims the address on first access.",
        "parameters": [
          {
            "name": "address",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "alice@agentlair.dev"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 20
            }
          },
          {
            "name": "unread",
            "in": "query",
            "schema": {
              "type": "boolean"
            },
            "description": "Filter to unread messages only"
          }
        ],
        "responses": {
          "200": {
            "description": "Messages list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "messages": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "from": {
                            "type": "string"
                          },
                          "subject": {
                            "type": "string"
                          },
                          "preview": {
                            "type": "string"
                          },
                          "received_at": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "read": {
                            "type": "boolean"
                          }
                        }
                      }
                    },
                    "total": {
                      "type": "integer"
                    },
                    "address": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/inbox/{address}/messages/{id}": {
      "get": {
        "tags": [
          "inbox"
        ],
        "summary": "Get message",
        "parameters": [
          {
            "name": "address",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Full message",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "from": {
                      "type": "string"
                    },
                    "to": {
                      "type": "string"
                    },
                    "subject": {
                      "type": "string"
                    },
                    "body": {
                      "type": "string"
                    },
                    "received_at": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/inbox/{address}/send": {
      "post": {
        "tags": [
          "inbox"
        ],
        "summary": "Send from inbox address",
        "parameters": [
          {
            "name": "address",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "to",
                  "subject"
                ],
                "properties": {
                  "to": {
                    "oneOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ]
                  },
                  "subject": {
                    "type": "string"
                  },
                  "body": {
                    "type": "string",
                    "description": "Plain text body"
                  },
                  "html": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Email sent",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sent": {
                      "type": "boolean"
                    },
                    "id": {
                      "type": "string"
                    },
                    "from": {
                      "type": "string"
                    },
                    "to": {
                      "oneOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        }
                      ]
                    },
                    "subject": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/observations": {
      "post": {
        "tags": [
          "observations"
        ],
        "summary": "Write observation",
        "description": "Store a structured observation. Observations are account-scoped by default.\nSet `shared: true` to make the observation visible to all authenticated agents —\nuseful for cross-agent coordination and shared state.\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "topic",
                  "content"
                ],
                "properties": {
                  "topic": {
                    "type": "string",
                    "example": "market-signals"
                  },
                  "content": {
                    "type": "string",
                    "maxLength": 10000
                  },
                  "shared": {
                    "type": "boolean",
                    "default": false,
                    "description": "If true, visible to all authenticated agents"
                  },
                  "display_name": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "Optional display name for the writing agent"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Observation written",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Observation"
                }
              }
            }
          },
          "400": {
            "description": "Missing fields or invalid content"
          }
        }
      },
      "get": {
        "tags": [
          "observations"
        ],
        "summary": "Read observations",
        "description": "Read observations. By default returns own + shared observations (`scope=all`).\nFilter by topic, agent_id, time range, or scope.\n",
        "parameters": [
          {
            "name": "topic",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "agent_id",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "since",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            },
            "description": "Return only observations created at or after this timestamp"
          },
          {
            "name": "scope",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "all",
                "mine",
                "shared"
              ],
              "default": "all"
            },
            "description": "`mine` = own only, `shared` = shared only, `all` = own + shared"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50,
              "maximum": 200
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Observations list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "observations": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Observation"
                      }
                    },
                    "count": {
                      "type": "integer"
                    },
                    "filters": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/observations/topics": {
      "get": {
        "tags": [
          "observations"
        ],
        "summary": "List topics",
        "description": "List distinct topics with observation count and latest timestamp.",
        "responses": {
          "200": {
            "description": "Topics list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "topics": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "topic": {
                            "type": "string"
                          },
                          "count": {
                            "type": "integer"
                          },
                          "latest": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/vault/": {
      "get": {
        "tags": [
          "vault"
        ],
        "summary": "List vault keys",
        "description": "List all vault keys for this account. Returns metadata only — never ciphertext.\nFree tier: 10 keys. Paid: unlimited.\n",
        "responses": {
          "200": {
            "description": "Keys list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "keys": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string"
                          },
                          "version": {
                            "type": "integer"
                          },
                          "metadata": {
                            "type": "object",
                            "nullable": true
                          },
                          "created_at": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "updated_at": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "count": {
                      "type": "integer"
                    },
                    "limit": {
                      "type": "integer"
                    },
                    "tier": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/vault/recovery-email": {
      "post": {
        "tags": [
          "vault"
        ],
        "summary": "Register recovery email + encrypted seed",
        "description": "Associate a recovery email with this account's vault. Provide a client-side encrypted seed\nblob for recovery. The seed is retrievable via `POST /v1/vault/recover` (magic link flow).\n",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "encrypted_seed"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "encrypted_seed": {
                    "type": "string",
                    "description": "Base64 or hex encoded client-side ciphertext (max 100KB)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Recovery email registered",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    },
                    "email": {
                      "type": "string"
                    },
                    "stored_at": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/vault/{key}": {
      "put": {
        "tags": [
          "vault"
        ],
        "summary": "Store encrypted blob",
        "description": "Store an encrypted blob under a named key (versioned, append-only).\nAgentLair stores the opaque ciphertext — never sees plaintext.\nVersion history is maintained up to tier limits (free: 3 versions, paid: 100).\n",
        "parameters": [
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9_\\-.]{1,128}$"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "ciphertext"
                ],
                "properties": {
                  "ciphertext": {
                    "type": "string",
                    "description": "Base64url or hex encoded ciphertext (max 16KB free / 64KB paid)"
                  },
                  "metadata": {
                    "type": "object",
                    "description": "Optional unencrypted metadata (max 4KB)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Existing key updated (new version)"
          },
          "201": {
            "description": "New key created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "key": {
                      "type": "string"
                    },
                    "stored": {
                      "type": "boolean"
                    },
                    "version": {
                      "type": "integer"
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "updated_at": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid ciphertext or metadata"
          },
          "403": {
            "description": "Vault key limit reached"
          }
        }
      },
      "get": {
        "tags": [
          "vault"
        ],
        "summary": "Get encrypted blob",
        "parameters": [
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "version",
            "in": "query",
            "schema": {
              "type": "integer"
            },
            "description": "Specific version to retrieve (defaults to latest)"
          }
        ],
        "responses": {
          "200": {
            "description": "Vault entry",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/VaultEntry"
                }
              }
            }
          },
          "404": {
            "description": "Key or version not found"
          }
        }
      },
      "delete": {
        "tags": [
          "vault"
        ],
        "summary": "Delete vault key",
        "description": "Delete all versions of a key. Pass `?version=N` to delete only a specific version.",
        "parameters": [
          {
            "name": "key",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "version",
            "in": "query",
            "schema": {
              "type": "integer"
            },
            "description": "Specific version to delete (omit to delete all)"
          }
        ],
        "responses": {
          "200": {
            "description": "Key or version deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "key": {
                      "type": "string"
                    },
                    "deleted": {
                      "type": "boolean"
                    },
                    "versions_removed": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not found"
          }
        }
      }
    },
    "/v1/vault/store": {
      "post": {
        "tags": [
          "vault-legacy"
        ],
        "summary": "Store encrypted seed (legacy, no auth)",
        "description": "Store a client-side encrypted seed blob without authentication.\nUseful for anonymous recovery flows. Rate limited to 5 entries per email per day.\nUse the v2 Vault (`PUT /v1/vault/{key}`) for authenticated, versioned storage.\n",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "encrypted_seed",
                  "recovery_email"
                ],
                "properties": {
                  "encrypted_seed": {
                    "type": "string",
                    "description": "Base64 or hex encoded ciphertext (max 50KB)"
                  },
                  "recovery_email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Seed stored",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "vault_id": {
                      "type": "string"
                    },
                    "stored_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "429": {
            "description": "Rate limited"
          }
        }
      }
    },
    "/v1/vault/recover": {
      "post": {
        "tags": [
          "vault-legacy"
        ],
        "summary": "Request recovery link",
        "description": "Send a magic link to the recovery email. The link is single-use and expires in 15 minutes.\nOn click, redirects to `GET /v1/vault/recover/verify?token=...` which returns the\nencrypted seed blobs.\n",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Recovery link sent (or silently no-op if no vault entries for email)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sent": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "description": "Rate limited (3 attempts per email per hour)"
          }
        }
      }
    },
    "/v1/vault/recover/verify": {
      "get": {
        "tags": [
          "vault-legacy"
        ],
        "summary": "Verify recovery token",
        "description": "Verify the single-use recovery token from the magic link email.\nReturns all encrypted seed blobs for the associated email.\nToken is immediately invalidated on use.\n",
        "security": [],
        "parameters": [
          {
            "name": "token",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Encrypted seeds returned",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "recovered": {
                      "type": "boolean"
                    },
                    "entries": {
                      "type": "array",
                      "description": "v2 vault entries",
                      "items": {
                        "type": "object",
                        "properties": {
                          "account_id": {
                            "type": "string"
                          },
                          "key": {
                            "type": "string"
                          },
                          "ciphertext": {
                            "type": "string"
                          },
                          "metadata": {
                            "type": "object",
                            "nullable": true
                          },
                          "version": {
                            "type": "integer"
                          },
                          "created_at": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "legacy_entries": {
                      "type": "array",
                      "description": "Legacy seed blobs",
                      "items": {
                        "type": "object",
                        "properties": {
                          "vault_id": {
                            "type": "string"
                          },
                          "encrypted_seed": {
                            "type": "string"
                          },
                          "created_at": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid or expired token"
          }
        }
      }
    },
    "/v1/pods": {
      "post": {
        "tags": [
          "pods"
        ],
        "summary": "Create pod",
        "description": "Create a new multi-tenant pod. Only platform keys (al_live_...) can create pods. Returns a pod API key (al_pod_...) for use by downstream agents.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Optional label for the pod",
                    "example": "customer-123"
                  },
                  "rate_limits": {
                    "$ref": "#/components/schemas/PodRateLimits",
                    "description": "Optional request rate limits for this pod"
                  },
                  "spending_caps": {
                    "$ref": "#/components/schemas/SpendingCaps",
                    "description": "Optional atomic USDC spending caps for this pod"
                  }
                }
              },
              "example": {
                "name": "customer-123",
                "spending_caps": {
                  "daily": 1000000,
                  "weekly": 5000000,
                  "monthly": 20000000
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Pod created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "pod_id": {
                      "type": "string",
                      "example": "pod_abc123def456"
                    },
                    "api_key": {
                      "type": "string",
                      "description": "Pod API key — save immediately, not shown again",
                      "example": "al_pod_k7x9m2p4abcdefghijklmnopqrstuvwxyz12"
                    },
                    "name": {
                      "type": "string",
                      "nullable": true,
                      "example": "customer-123"
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "active",
                        "suspended"
                      ]
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "rate_limits": {
                      "nullable": true,
                      "allOf": [
                        { "$ref": "#/components/schemas/PodRateLimits" }
                      ]
                    },
                    "spending_caps": {
                      "nullable": true,
                      "allOf": [
                        { "$ref": "#/components/schemas/SpendingCaps" }
                      ]
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Forbidden — pod keys cannot create pods",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "tags": [
          "pods"
        ],
        "summary": "List pods",
        "description": "List all pods for the current platform account.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "List of pods",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "pods": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Pod"
                      }
                    },
                    "count": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/pods/{pod_id}": {
      "get": {
        "tags": [
          "pods"
        ],
        "summary": "Get pod details",
        "description": "Retrieve details for a specific pod.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "pod_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "pod_abc123def456"
          }
        ],
        "responses": {
          "200": {
            "description": "Pod details",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Pod"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Pod not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": [
          "pods"
        ],
        "summary": "Update pod",
        "description": "Update a pod's name, rate limits, and/or spending caps. Only platform keys (al_live_...) can update pods. Set rate_limits or spending_caps to null to remove them.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "pod_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "pod_abc123def456"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "nullable": true,
                    "description": "New label for the pod. Set to null or empty string to clear.",
                    "example": "updated-name"
                  },
                  "rate_limits": {
                    "nullable": true,
                    "allOf": [
                      { "$ref": "#/components/schemas/PodRateLimits" }
                    ],
                    "description": "New rate limits for this pod. Set to null to remove rate limits."
                  },
                  "spending_caps": {
                    "nullable": true,
                    "allOf": [
                      { "$ref": "#/components/schemas/SpendingCaps" }
                    ],
                    "description": "New spending caps for this pod. Set to null to remove spending caps."
                  }
                }
              },
              "example": {
                "spending_caps": {
                  "daily": 1000000,
                  "weekly": 5000000,
                  "monthly": 20000000
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Pod updated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "example": "pod_abc123def456"
                    },
                    "name": {
                      "type": "string",
                      "nullable": true,
                      "example": "updated-name"
                    },
                    "status": {
                      "type": "string",
                      "enum": ["active", "suspended"]
                    },
                    "rate_limits": {
                      "nullable": true,
                      "allOf": [
                        { "$ref": "#/components/schemas/PodRateLimits" }
                      ]
                    },
                    "spending_caps": {
                      "nullable": true,
                      "allOf": [
                        { "$ref": "#/components/schemas/SpendingCaps" }
                      ]
                    },
                    "updated": {
                      "type": "boolean",
                      "example": true
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Forbidden — pod keys cannot update pod settings",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Pod not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "tags": [
          "pods"
        ],
        "summary": "Suspend pod",
        "description": "Soft-delete a pod by setting its status to suspended. The pod and its data are retained.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "pod_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "pod_abc123def456"
          }
        ],
        "responses": {
          "200": {
            "description": "Pod suspended",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Pod"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Pod not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/pods/{pod_id}/keys": {
      "post": {
        "tags": [
          "pods"
        ],
        "summary": "Generate new pod API key",
        "description": "Generate a new API key for a pod. The previous key is invalidated.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "pod_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "pod_abc123def456"
          }
        ],
        "responses": {
          "201": {
            "description": "New pod API key generated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "api_key": {
                      "type": "string",
                      "description": "New pod API key — save immediately, not shown again",
                      "example": "al_pod_newkey123abcdefghijklmnopqrstuvwxyz"
                    },
                    "pod_id": {
                      "type": "string"
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Pod not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/calendar/events": {
      "post": {
        "tags": [
          "calendar"
        ],
        "summary": "Create calendar event",
        "description": "Create a new event in the agent's calendar.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "summary",
                  "start",
                  "end"
                ],
                "properties": {
                  "summary": {
                    "type": "string",
                    "description": "Event title"
                  },
                  "start": {
                    "type": "string",
                    "format": "date-time",
                    "description": "ISO 8601 start datetime"
                  },
                  "end": {
                    "type": "string",
                    "format": "date-time",
                    "description": "ISO 8601 end datetime"
                  },
                  "description": {
                    "type": "string",
                    "description": "Optional event notes"
                  },
                  "location": {
                    "type": "string",
                    "description": "Optional location"
                  },
                  "attendees": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "email"
                    },
                    "description": "Optional list of attendee email addresses"
                  }
                }
              },
              "example": {
                "summary": "Team sync",
                "start": "2026-04-01T10:00:00Z",
                "end": "2026-04-01T11:00:00Z",
                "description": "Weekly team meeting",
                "attendees": [
                  "alice@example.com"
                ]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Event created",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CalEvent"
                }
              }
            }
          },
          "400": {
            "description": "Invalid request body",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "tags": [
          "calendar"
        ],
        "summary": "List calendar events",
        "description": "Retrieve events from the agent's calendar with optional date filtering.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            },
            "description": "ISO 8601 start of range"
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            },
            "description": "ISO 8601 end of range"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            },
            "description": "Maximum number of events to return (default 50)"
          }
        ],
        "responses": {
          "200": {
            "description": "List of events",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "events": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/CalEvent"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/calendar/events/{event_id}": {
      "delete": {
        "tags": [
          "calendar"
        ],
        "summary": "Delete calendar event",
        "description": "Delete a specific calendar event by ID.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "event_id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "evt_abc123def456"
          }
        ],
        "responses": {
          "200": {
            "description": "Event deleted",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "deleted": {
                      "type": "boolean",
                      "example": true
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Event not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/calendar/feed": {
      "get": {
        "tags": [
          "calendar"
        ],
        "summary": "Get iCal subscription URL",
        "description": "Get (or generate) a public iCal subscription URL for the agent's calendar.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "iCal feed URL",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "url": {
                      "type": "string",
                      "format": "uri",
                      "example": "https://agentlair.dev/v1/calendar/feed.ics?cal_token=ct_abc123"
                    },
                    "cal_token": {
                      "type": "string",
                      "example": "ct_abc123def456"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/calendar/feed.ics": {
      "get": {
        "tags": [
          "calendar"
        ],
        "summary": "Public iCal feed",
        "description": "Public iCal (RFC 5545) feed for the agent's calendar. Authenticated via `cal_token` query parameter instead of Bearer token. Suitable for calendar app subscriptions.",
        "security": [],
        "parameters": [
          {
            "name": "cal_token",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "Calendar token from GET /v1/calendar/feed",
            "example": "ct_abc123def456"
          }
        ],
        "responses": {
          "200": {
            "description": "iCal calendar feed",
            "content": {
              "text/calendar": {
                "schema": {
                  "type": "string",
                  "description": "RFC 5545 iCal content"
                }
              }
            }
          },
          "401": {
            "description": "Invalid or missing cal_token"
          }
        }
      }
    },
    "/v1/ws": {
      "get": {
        "tags": [
          "websocket"
        ],
        "summary": "Real-time inbox notifications (WebSocket)",
        "description": "Upgrade to a WebSocket connection for real-time inbox notifications. Authenticated via `?token=al_live_...` query parameter (Authorization headers are not supported for WebSocket upgrades). On successful upgrade, the server streams JSON notification events as they arrive.",
        "security": [],
        "parameters": [
          {
            "name": "token",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "API key (al_live_...) passed as query param",
            "example": "al_live_k7x9m2p4abcdefghijklmnopqrstuvwxyz12"
          }
        ],
        "responses": {
          "101": {
            "description": "Switching Protocols — WebSocket connection established"
          },
          "401": {
            "description": "Invalid or missing token"
          }
        }
      }
    },
    "/agents/{name}": {
      "get": {
        "tags": [
          "agent-profiles"
        ],
        "summary": "Agent profile page",
        "description": "Content-negotiated agent identity page. Returns HTML for browsers, JSON for agents and API clients. No authentication required.",
        "security": [],
        "parameters": [
          {
            "name": "name",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "example": "myagent"
          }
        ],
        "responses": {
          "200": {
            "description": "Agent profile (JSON or HTML depending on Accept header)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string",
                      "example": "myagent"
                    },
                    "address": {
                      "type": "string",
                      "example": "myagent@agentlair.dev"
                    },
                    "description": {
                      "type": "string",
                      "nullable": true
                    },
                    "capabilities": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "verified": {
                      "type": "boolean"
                    }
                  }
                }
              },
              "text/html": {
                "schema": {
                  "type": "string",
                  "description": "HTML agent profile page"
                }
              }
            }
          },
          "404": {
            "description": "Agent not found"
          }
        }
      }
    },
    "/v1/credentials/request": {
      "post": {
        "tags": [
          "credentials"
        ],
        "summary": "Request a credential (agent)",
        "description": "Initiates a credential device flow. The agent provides the type and service name, and receives a `device_code` + `user_code`. The user code must be shown to the operator (or sent via email, which AgentLair handles automatically). The agent then polls `/v1/credentials/poll` until the credential is delivered or the request expires (5 minutes).",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["credential_type", "service_name"],
                "properties": {
                  "credential_type": {
                    "type": "string",
                    "enum": ["api_key", "password", "token", "certificate"],
                    "description": "Type of credential being requested"
                  },
                  "service_name": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "Name of the service the credential is for",
                    "example": "GitHub"
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Optional human-readable description of why the credential is needed",
                    "example": "Read access to private repos"
                  }
                }
              },
              "example": {
                "credential_type": "api_key",
                "service_name": "GitHub",
                "description": "Read access to private repos"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Credential request created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "device_code": {
                      "type": "string",
                      "description": "Opaque device code used for polling. Keep secret.",
                      "example": "dc_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901"
                    },
                    "user_code": {
                      "type": "string",
                      "description": "Short human-readable code shown to the operator. Format: XXXX-XXXX.",
                      "example": "ABCD-1234"
                    },
                    "expires_in": {
                      "type": "integer",
                      "description": "Seconds until the request expires",
                      "example": 300
                    },
                    "interval": {
                      "type": "integer",
                      "description": "Recommended polling interval in seconds",
                      "example": 5
                    },
                    "message": {
                      "type": "string",
                      "description": "Human-readable instruction for the agent",
                      "example": "Ask operator to visit https://agentlair.dev/v1/credentials/approve?code=ABCD-1234"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid request body",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Authentication required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Too many active credential requests (max 5 per account)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/credentials/approve": {
      "get": {
        "tags": [
          "credentials"
        ],
        "summary": "Get pending credential request details (operator)",
        "description": "Retrieves details of a pending credential request by user code. The operator uses this to review what credential the agent is requesting before approving or denying.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "code",
            "in": "query",
            "required": true,
            "description": "The user code shown by the agent (format: XXXX-XXXX)",
            "schema": {
              "type": "string",
              "example": "ABCD-1234"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Pending request details",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "device_code": {
                      "type": "string"
                    },
                    "credential_type": {
                      "type": "string",
                      "enum": ["api_key", "password", "token", "certificate"]
                    },
                    "service_name": {
                      "type": "string"
                    },
                    "description": {
                      "type": "string",
                      "nullable": true
                    },
                    "requested_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "expires_at": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "agent_id": {
                      "type": "string"
                    },
                    "agent_name": {
                      "type": "string"
                    },
                    "agent_email": {
                      "type": "string",
                      "nullable": true
                    },
                    "status": {
                      "type": "string",
                      "enum": ["pending"]
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Missing or invalid code parameter",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Authentication required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Invalid or expired user code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "credentials"
        ],
        "summary": "Approve or deny a credential request (operator)",
        "description": "The operator approves or denies a pending credential request. Requires `vault_key` (the vault slot to store the credential) and `operator_email` (must match the account's registered email for binding). If `approved` is `true`, `credential_value` must also be provided — this is the actual secret that will be one-time-delivered to the agent on next poll. If `approved` is `false`, the agent will receive a `denied` status on next poll.",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["user_code", "approved", "vault_key", "operator_email"],
                "properties": {
                  "user_code": {
                    "type": "string",
                    "description": "The user code shown by the agent (format: XXXX-XXXX)",
                    "example": "ABCD-1234"
                  },
                  "approved": {
                    "type": "boolean",
                    "description": "Whether to approve (true) or deny (false) the request"
                  },
                  "vault_key": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "The vault key name where the credential will be stored. Pre-populated from the agent's request — the operator may change it.",
                    "example": "openai-api-key"
                  },
                  "operator_email": {
                    "type": "string",
                    "format": "email",
                    "description": "The operator's email address. Must match the account's registered `operator_email` for binding/security validation.",
                    "example": "operator@example.com"
                  },
                  "credential_value": {
                    "type": "string",
                    "maxLength": 8192,
                    "description": "The actual credential value to deliver to the agent. Required when `approved` is true.",
                    "example": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  }
                }
              },
              "examples": {
                "approve": {
                  "summary": "Approve with credential value",
                  "value": {
                    "user_code": "ABCD-1234",
                    "approved": true,
                    "vault_key": "openai-api-key",
                    "operator_email": "operator@example.com",
                    "credential_value": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  }
                },
                "deny": {
                  "summary": "Deny request",
                  "value": {
                    "user_code": "ABCD-1234",
                    "approved": false,
                    "vault_key": "openai-api-key",
                    "operator_email": "operator@example.com"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Request approved or denied",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "enum": ["approved", "denied"]
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                },
                "examples": {
                  "approved": {
                    "value": {
                      "status": "approved",
                      "message": "Credential will be delivered to the agent on next poll."
                    }
                  },
                  "denied": {
                    "value": {
                      "status": "denied",
                      "message": "Credential request denied."
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid request body or expired/already-processed code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Authentication required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Max approval attempts exceeded for this code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/credentials/poll": {
      "post": {
        "tags": [
          "credentials"
        ],
        "summary": "Poll for credential delivery (agent)",
        "description": "The agent polls with its `device_code` to check whether the operator has approved or denied the request. When status is `approved`, the `credential` field contains the one-time-delivered secret — it is deleted from AgentLair storage immediately after this response. Recommended interval: 5 seconds (as returned in the request response).",
        "security": [
          {
            "bearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["device_code"],
                "properties": {
                  "device_code": {
                    "type": "string",
                    "description": "The device code returned by POST /v1/credentials/request",
                    "example": "dc_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Poll result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "enum": ["pending", "approved", "denied", "expired", "slow_down"],
                      "description": "Current status of the credential request"
                    },
                    "credential": {
                      "type": "string",
                      "description": "The credential value. Present only when status is `approved`. One-time delivery — not recoverable after this response.",
                      "example": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    },
                    "interval": {
                      "type": "integer",
                      "description": "Present only when status is `slow_down`. New recommended polling interval in seconds.",
                      "example": 30
                    }
                  }
                },
                "examples": {
                  "pending": {
                    "value": { "status": "pending" }
                  },
                  "approved": {
                    "value": {
                      "status": "approved",
                      "credential": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    }
                  },
                  "denied": {
                    "value": { "status": "denied" }
                  },
                  "expired": {
                    "value": { "status": "expired" }
                  },
                  "slow_down": {
                    "value": { "status": "slow_down", "interval": 30 }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Missing device_code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Authentication required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Device code does not belong to authenticated account",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/auth/agent-register": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Zero-human agent onboarding",
        "description": "Register a new agent account without human interaction. Optionally provide a name, email address, X25519 public key for E2E encryption, and a recovery email. Returns a ready-to-use API key. No authentication required.",
        "security": [],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Optional agent name (becomes email username)",
                    "example": "my-agent"
                  },
                  "address": {
                    "type": "string",
                    "description": "Optional desired email address",
                    "example": "my-agent@agentlair.dev"
                  },
                  "public_key": {
                    "type": "string",
                    "description": "Optional base64url-encoded X25519 public key (32 bytes) for E2E encryption",
                    "example": "base64url_encoded_x25519_public_key"
                  },
                  "recovery_email": {
                    "type": "string",
                    "format": "email",
                    "description": "Optional recovery email for account recovery"
                  }
                }
              },
              "example": {
                "name": "my-agent",
                "recovery_email": "operator@example.com"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Agent registered",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "api_key": {
                      "type": "string",
                      "description": "API key — save immediately, not shown again",
                      "example": "al_live_k7x9m2p4abcdefghijklmnopqrstuvwxyz12"
                    },
                    "account_id": {
                      "type": "string"
                    },
                    "email_address": {
                      "type": "string",
                      "format": "email",
                      "example": "my-agent@agentlair.dev"
                    },
                    "tier": {
                      "type": "string",
                      "enum": [
                        "free"
                      ]
                    },
                    "e2e_enabled": {
                      "type": "boolean"
                    },
                    "created_at": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Invalid request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/trust/score": {
      "get": {
        "tags": ["trust"],
        "summary": "Get behavioral trust score for an agent (query-param style)",
        "description": "Returns the behavioral trust score, tier, and component breakdown for the specified agent. Accepts agent_id as a query parameter. No auth required — anonymous callers pay 0.01 USDC via x402; authenticated callers use their API key.",
        "security": [{ "bearerAuth": [] }, {}],
        "parameters": [
          {
            "name": "agent_id",
            "in": "query",
            "required": true,
            "description": "Agent account ID (format: acc_<alphanumeric>)",
            "schema": {
              "type": "string",
              "pattern": "^acc_[A-Za-z0-9_-]{1,64}$",
              "example": "acc_qgdxSULsXsmtHklZ"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Trust score",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "agentId": { "type": "string", "example": "acc_qgdxSULsXsmtHklZ" },
                    "score": { "type": "integer", "minimum": 0, "maximum": 1000, "description": "Composite trust score (0-1000)", "example": 750 },
                    "tier": { "type": "string", "enum": ["untrusted", "provisional", "trusted", "verified"], "example": "trusted" },
                    "breakdown": {
                      "type": "object",
                      "properties": {
                        "consistency": { "type": "number", "description": "Behavioral consistency score component" },
                        "longevity": { "type": "number", "description": "Account longevity score component" },
                        "transparency": { "type": "number", "description": "Transparency score component" },
                        "volume": { "type": "number", "description": "Activity volume score component" }
                      }
                    }
                  },
                  "required": ["agentId", "score", "tier", "breakdown"]
                }
              }
            }
          },
          "400": {
            "description": "Invalid agent ID",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Error" },
                "example": { "error": "invalid_agent_id" }
              }
            }
          },
          "402": {
            "description": "Payment required (anonymous access — pay 0.01 USDC via x402)"
          },
          "503": {
            "description": "Trust scoring database not available",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    "/v1/trust/{agentId}": {
      "get": {
        "tags": ["trust"],
        "summary": "Get behavioral trust score for an agent",
        "description": "Returns the behavioral trust score, tier, and component breakdown for the specified agent.",
        "security": [{ "bearerAuth": [] }],
        "parameters": [
          {
            "name": "agentId",
            "in": "path",
            "required": true,
            "description": "Agent account ID",
            "schema": {
              "type": "string",
              "pattern": "^acc_[A-Za-z0-9_-]{1,64}$",
              "example": "acc_k7x9m2p4abcd1234"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Trust score",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "agentId": { "type": "string", "example": "acc_k7x9m2p4abcd1234" },
                    "score": { "type": "integer", "minimum": 0, "maximum": 1000, "description": "Composite trust score (0-1000)", "example": 750 },
                    "tier": { "type": "string", "enum": ["untrusted", "provisional", "trusted", "verified"], "example": "trusted" },
                    "breakdown": {
                      "type": "object",
                      "properties": {
                        "consistency": { "type": "number", "description": "Behavioral consistency score component" },
                        "longevity": { "type": "number", "description": "Account longevity score component" },
                        "transparency": { "type": "number", "description": "Transparency score component" },
                        "volume": { "type": "number", "description": "Activity volume score component" }
                      }
                    }
                  },
                  "required": ["agentId", "score", "tier", "breakdown"]
                }
              }
            }
          },
          "400": {
            "description": "Invalid agent ID",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Error" },
                "example": { "error": "invalid_agent_id" }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Error" },
                "example": { "error": "unauthorized" }
              }
            }
          },
          "404": {
            "description": "Agent not found",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Error" },
                "example": { "error": "not_found" }
              }
            }
          },
          "502": {
            "description": "Upstream database error",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": { "type": "string", "example": "turso_error" },
                    "detail": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};
export const SCALAR_DOCS_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <title>AgentLair API Reference</title>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <meta name=\"description\" content=\"AgentLair REST API reference — email and secrets for AI agents. Claim addresses, send mail, read inbox, manage vault secrets.\" />\n  <style>\n    body { margin: 0; padding: 0; }\n    .al-topbar { display:flex; align-items:center; gap:1rem; padding:0.65rem 1.5rem; background:#fff; border-bottom:1px solid #e5e7eb; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:0.82rem; }\n    .al-topbar a { color:#111; text-decoration:none; font-weight:500; }\n    .al-topbar a:hover { color:#6366f1; }\n    .al-topbar span { color:#d1d5db; }\n  </style>\n</head>\n<body>\n  <div class=\"al-topbar\">\n    <a href=\"/\">\u2190 agentlair.dev</a>\n    <span>&middot;</span>\n    <a href=\"/getting-started\">Getting Started</a>\n    <span>&middot;</span>\n    <a href=\"/security\">Security</a>\n  </div>\n  <script id=\"api-reference\" data-url=\"/api\" data-configuration='{\"darkMode\":false,\"theme\":\"default\",\"hideModels\":false,\"layout\":\"modern\"}'></script>\n  <script src=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference\"></script>\n</body>\n</html>";
