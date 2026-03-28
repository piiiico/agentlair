import { useState, useCallback } from "react";
import { apiCall } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddressManagerProps {
  onClaimed?: () => void;
}

export function AddressManager({ onClaimed }: AddressManagerProps) {
  const [localPart, setLocalPart] = useState("");
  const [status, setStatus] = useState<{
    type: "idle" | "claiming" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleClaim = useCallback(async () => {
    const local = localPart.trim().toLowerCase();
    if (!local) {
      setStatus({ type: "error", message: "Enter an address name" });
      return;
    }

    const address = `${local}@agentlair.dev`;
    setStatus({ type: "claiming" });

    const { ok, data } = await apiCall<{ message?: string }>("/v1/email/claim", {
      method: "POST",
      body: JSON.stringify({ address }),
    });

    if (ok) {
      setStatus({ type: "success", message: `${address} claimed!` });
      setLocalPart("");
      onClaimed?.();
    } else {
      setStatus({ type: "error", message: data.message || "Claim failed" });
    }
  }, [localPart, onClaimed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Claim New Address
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="my-agent"
            className="flex-1 min-w-[120px] font-mono"
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleClaim()}
          />
          <span className="text-sm text-muted-foreground">@agentlair.dev</span>
          <Button onClick={handleClaim} disabled={status.type === "claiming"}>
            Claim
          </Button>
        </div>
        {status.type === "success" && (
          <p className="text-sm text-green-600 dark:text-green-400 mt-2">
            &#x2713; {status.message}
          </p>
        )}
        {status.type === "error" && (
          <p className="text-sm text-destructive mt-2">{status.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
