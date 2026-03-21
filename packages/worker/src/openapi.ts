// ─── API Discovery JSON & OpenAPI Spec ────────────────────────────────────────

export const API_DISCOVERY = {
  name: 'AgentLair API',
  version: '0.16.0',
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
  },
  note: 'Beta: email live (inbound + outbound), shared observations live. E2E key rotation live. Vault (encrypted seed storage) live. DNS/hosting Q2 2026.',
};

export const OPENAPI_SPEC = {
  "openapi": "3.1.0",
  "info": {
    "title": "AgentLair API",
    "version": "0.16.0",
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
      "name": "e2e",
      "description": "End-to-end encryption key management"
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
                      "example": "0.16.0"
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
        "description": "Send an email from an `@agentlair.dev` address you own.\nFree tier: 10 emails/day, 10 recipients/send.\nPaid tier: 50 recipients/send, higher limits.\n\nWhen rate limited, returns HTTP 402 with x402 payment requirements.\nInclude `X-PAYMENT` header with a valid payment to bypass limits (0.01 USDC on Base).\n",
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
    }
  }
};
export const SCALAR_DOCS_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <title>AgentLair API Reference</title>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <meta name=\"description\" content=\"AgentLair REST API reference — email and secrets for AI agents. Claim addresses, send mail, read inbox, manage vault secrets.\" />\n  <style>\n    body { margin: 0; padding: 0; background: #0a0a0a; }\n    .al-topbar { display:flex; align-items:center; gap:1rem; padding:0.6rem 1.2rem; background:#111; border-bottom:1px solid #1e1e1e; font-family:monospace; font-size:0.82rem; }\n    .al-topbar a { color:#22c55e; text-decoration:none; }\n    .al-topbar a:hover { text-decoration:underline; }\n    .al-topbar span { color:#555; }\n  </style>\n</head>\n<body>\n  <div class=\"al-topbar\">\n    <a href=\"/\">\u2190 agentlair.dev</a>\n    <span>&middot;</span>\n    <a href=\"/getting-started\">Getting Started</a>\n    <span>&middot;</span>\n    <a href=\"/security\">Security</a>\n  </div>\n  <script id=\"api-reference\" data-url=\"/api\" data-configuration='{\"darkMode\":true,\"theme\":\"default\",\"hideModels\":false}'></script>\n  <script src=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference\"></script>\n</body>\n</html>";
