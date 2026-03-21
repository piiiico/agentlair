// ─── InboxNotifier Durable Object ────────────────────────────────────────────
// One instance per account (keyed by account_id).
// Uses CF WebSocket Hibernation API for cost efficiency.
// Clients hold open connections; inbound email handler calls notify() to fan-out.

export class InboxNotifier {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');

    // ── WebSocket upgrade ───────────────────────────────────────────────────
    if (upgrade === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Internal notify endpoint ────────────────────────────────────────────
    // Called by the email() handler to push notifications to all connected clients.
    if (request.method === 'POST') {
      const url = new URL(request.url);
      if (url.pathname === '/notify') {
        let payload: string;
        try {
          const body = await request.json() as unknown;
          payload = JSON.stringify(body);
        } catch {
          return new Response('Bad request', { status: 400 });
        }

        const sockets = this.state.getWebSockets();
        let sent = 0;
        for (const ws of sockets) {
          try {
            ws.send(payload);
            sent++;
          } catch {
            // Socket may be mid-close — swallow the error
          }
        }
        return new Response(JSON.stringify({ sent }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  }

  // ── WebSocket Hibernation API event handlers ────────────────────────────────
  // Required by CF Hibernation API. Server-push only — client messages are ignored.

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // No-op: this is a server-push channel; client messages are ignored
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API handles cleanup automatically
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Swallow errors — CF runtime cleans up the connection
  }
}
