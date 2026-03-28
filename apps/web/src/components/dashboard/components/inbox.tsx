import { useState, useEffect, useCallback } from "react";
import { apiCall } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface InboxMessage {
  id?: string;
  message_id?: string;
  from?: string;
  subject?: string;
  received_at?: string;
}

interface FullMessage extends InboxMessage {
  body?: string;
  text?: string;
  html?: string;
  to?: string;
}

interface OutboxMessage {
  id?: string;
  from?: string;
  to?: string | string[];
  to_address?: string;
  subject?: string;
  text?: string;
  body?: string;
  sent_at?: string;
  created_at?: string;
  status?: string;
}

function formatTime(ts?: string) {
  if (!ts) return "";
  return ts.slice(0, 16).replace("T", " ");
}

function AddressInbox({ address }: { address: string }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<FullMessage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);

  useEffect(() => {
    (async () => {
      const { ok, data } = await apiCall<{ messages?: InboxMessage[] }>(
        `/v1/email/inbox?address=${encodeURIComponent(address)}&limit=5`
      );
      setMessages(ok && data.messages ? data.messages : []);
      setLoading(false);
    })();
  }, [address]);

  const readMessage = useCallback(
    async (msgId: string) => {
      setLoadingMessage(true);
      setDialogOpen(true);
      const { ok, data } = await apiCall<FullMessage>(
        `/v1/email/messages/${encodeURIComponent(msgId)}?address=${encodeURIComponent(address)}`
      );
      if (ok) {
        setSelectedMessage(data);
      } else {
        setSelectedMessage({
          subject: "Error",
          body: (data as { message?: string }).message || "Failed to load message.",
        });
      }
      setLoadingMessage(false);
    },
    [address]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Spinner className="size-3" />
        Loading inbox...
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="font-mono text-sm text-primary">{address}</div>
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty inbox</p>
      ) : (
        <>
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Inbox ({messages.length})
          </div>
          <div className="space-y-1">
            {messages.map((m) => {
              const msgId = m.id || m.message_id || "";
              return (
                <button
                  key={msgId}
                  onClick={() => msgId && readMessage(msgId)}
                  className="w-full text-left border-l-2 border-border pl-3 py-1 text-sm hover:bg-accent/50 rounded-r transition-colors"
                >
                  <span className="font-medium">{m.from || "?"}</span>
                  <span className="text-muted-foreground"> &rarr; </span>
                  <span className="text-primary">
                    {m.subject || "(no subject)"}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {formatTime(m.received_at)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          {loadingMessage ? (
            <div className="flex items-center gap-2 py-8 justify-center">
              <Spinner /> Loading message...
            </div>
          ) : selectedMessage ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedMessage.subject || "(no subject)"}
                </DialogTitle>
                <DialogDescription>
                  From: {selectedMessage.from || "?"} &middot;{" "}
                  {formatTime(selectedMessage.received_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="bg-muted/50 border rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed max-h-[50vh] overflow-y-auto">
                {selectedMessage.body ||
                  selectedMessage.text ||
                  selectedMessage.html ||
                  "(no body)"}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Inbox({ addresses }: { addresses: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Email Addresses & Inbox
        </CardTitle>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No addresses claimed yet. Claim one above!
          </p>
        ) : (
          <div className="space-y-3">
            {addresses.map((addr) => (
              <AddressInbox key={addr} address={addr} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Outbox() {
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<OutboxMessage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { ok, data } = await apiCall<{ messages?: OutboxMessage[]; sent?: OutboxMessage[] }>(
        "/v1/email/outbox?limit=20"
      );
      const msgs = ok ? data.messages || data.sent || [] : [];
      setMessages(msgs);
      setLoading(false);
    })();
  }, []);

  const toDisplay = (msg: OutboxMessage) => {
    const raw = msg.to || msg.to_address || "?";
    return Array.isArray(raw) ? raw[0] : String(raw).split(",")[0];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Outbox{" "}
          <span className="normal-case tracking-normal font-normal text-muted-foreground">
            (last 20 sent)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3" />
            Loading...
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sent messages yet.</p>
        ) : (
          <div className="space-y-1">
            {messages.map((m, i) => (
              <button
                key={m.id || i}
                onClick={() => {
                  setSelectedMessage(m);
                  setDialogOpen(true);
                }}
                className="w-full text-left border-l-2 border-border pl-3 py-1 text-sm hover:bg-accent/50 rounded-r transition-colors"
              >
                <span className="font-medium">&rarr; {toDisplay(m)}</span>{" "}
                <span className="text-primary">
                  {m.subject || "(no subject)"}
                </span>{" "}
                <span className="text-xs text-muted-foreground">
                  {formatTime(m.sent_at || m.created_at)}
                </span>
              </button>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            {selectedMessage && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {selectedMessage.subject || "(no subject)"}
                  </DialogTitle>
                  <DialogDescription>
                    From: {selectedMessage.from || "?"} &rarr; To:{" "}
                    {String(selectedMessage.to || selectedMessage.to_address || "?")} &middot;{" "}
                    {formatTime(selectedMessage.sent_at || selectedMessage.created_at)}
                    {selectedMessage.status && ` \u00B7 ${selectedMessage.status}`}
                  </DialogDescription>
                </DialogHeader>
                <div className="bg-muted/50 border rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed max-h-[50vh] overflow-y-auto">
                  {selectedMessage.text || selectedMessage.body || "(no body)"}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

interface Observation {
  agent_id?: string;
  display_name?: string;
  topic?: string;
  content?: string;
  shared?: boolean;
  created_at?: string;
}

export function ObservationsFeed() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { ok, data } = await apiCall<{ observations?: Observation[] }>(
        "/v1/observations?scope=all&limit=20"
      );
      setObservations(ok && data.observations ? data.observations : []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Observations Feed{" "}
          <span className="normal-case tracking-normal font-normal text-muted-foreground">
            (own + shared, last 20)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3" />
            Loading...
          </div>
        ) : observations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No observations yet. Agents can write via POST /v1/observations.
          </p>
        ) : (
          <div className="space-y-1">
            {observations.map((o, i) => (
              <div key={i}>
                <button
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  className="w-full text-left border-l-2 border-border pl-3 py-1 text-sm hover:bg-accent/50 rounded-r transition-colors"
                >
                  {o.display_name ? (
                    <>
                      <span className="font-medium">{o.display_name}</span>{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        ({o.agent_id})
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      {o.agent_id}
                    </span>
                  )}{" "}
                  <Badge variant="outline" className="text-xs">
                    {o.topic}
                  </Badge>
                  {o.shared && (
                    <Badge
                      variant="outline"
                      className="text-xs text-green-600 dark:text-green-400 border-green-600 dark:border-green-400 ml-1"
                    >
                      shared
                    </Badge>
                  )}{" "}
                  <span className="text-xs text-muted-foreground">
                    {formatTime(o.created_at)}
                  </span>
                </button>
                {expandedIdx === i && (
                  <div className="bg-muted/50 border rounded-md p-3 text-sm whitespace-pre-wrap leading-relaxed break-words ml-3 mt-1 mb-2">
                    {o.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
