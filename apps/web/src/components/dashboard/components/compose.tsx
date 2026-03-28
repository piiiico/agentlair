import { useState, useCallback } from "react";
import { apiCall } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

interface ComposeProps {
  addresses: string[];
  onSent?: () => void;
}

export function Compose({ addresses, onSent }: ComposeProps) {
  const [from, setFrom] = useState(addresses[0] || "");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<{
    type: "idle" | "sending" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleSend = useCallback(async () => {
    const toAddr = to.trim();
    if (!from) {
      setStatus({ type: "error", message: 'Select a "from" address first' });
      return;
    }
    if (!toAddr) {
      setStatus({ type: "error", message: "Enter a recipient" });
      return;
    }
    if (!subject.trim() && !body.trim()) {
      setStatus({ type: "error", message: "Write a subject or message" });
      return;
    }

    setStatus({ type: "sending" });
    const { ok, data } = await apiCall<{ message?: string }>("/v1/email/send", {
      method: "POST",
      body: JSON.stringify({ from, to: [toAddr], subject: subject.trim(), text: body }),
    });

    if (ok) {
      setStatus({ type: "success", message: "Sent!" });
      setTo("");
      setSubject("");
      setBody("");
      // Refresh outbox after a brief delay
      setTimeout(() => onSent?.(), 1000);
    } else {
      setStatus({
        type: "error",
        message: data.message || "Send failed",
      });
    }
  }, [from, to, subject, body, onSent]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Compose Email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>From</Label>
          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">(claim an address first)</p>
          ) : (
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {addresses.map((a) => (
                  <SelectItem key={a} value={a} className="font-mono">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="compose-to">To</Label>
          <Input
            id="compose-to"
            type="email"
            placeholder="recipient@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="compose-subject">Subject</Label>
          <Input
            id="compose-subject"
            placeholder="Subject line"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="compose-body">Message</Label>
          <Textarea
            id="compose-body"
            placeholder="Write your message..."
            className="min-h-[120px] resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSend} disabled={status.type === "sending"}>
            {status.type === "sending" && <Spinner className="size-3.5" />}
            Send Email
          </Button>
          {status.type === "success" && (
            <span className="text-sm text-green-600 dark:text-green-400">
              &#x2713; {status.message}
            </span>
          )}
          {status.type === "error" && (
            <span className="text-sm text-destructive">{status.message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
