import { useState, useCallback } from "react";
import { useAuth } from "../auth";
import { apiCall } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function AccountCard() {
  const { account, logout, setApiKey, refreshAccount } = useAuth();
  const [showRotatePanel, setShowRotatePanel] = useState(false);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleRotateKey = useCallback(async () => {
    setNotice(null);
    const { ok, data } = await apiCall<{
      api_key?: string;
      key_prefix?: string;
      message?: string;
    }>("/v1/auth/keys/rotate", { method: "POST" });

    if (ok && data.api_key) {
      setNewKey(data.api_key);
      setShowRotatePanel(false);
      setApiKey(data.api_key);
      refreshAccount();
    } else {
      setNotice({
        type: "error",
        message: data.message || "Key rotation failed.",
      });
    }
  }, [setApiKey, refreshAccount]);

  const handleUpdateRecovery = useCallback(async () => {
    const email = recoveryInput.trim();
    if (!email) return;

    const { ok, data } = await apiCall<{ message?: string }>(
      "/v1/account/recovery-email",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      }
    );

    if (ok) {
      setShowRecoveryPanel(false);
      setRecoveryInput("");
      setNotice({ type: "success", message: "Recovery email updated." });
      refreshAccount();
    } else {
      setNotice({
        type: "error",
        message: data.message || "Update failed.",
      });
    }
  }, [recoveryInput, refreshAccount]);

  const tier = account?.tier || "free";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
          Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && (
          <Alert variant={notice.type === "error" ? "destructive" : "default"}>
            <AlertDescription
              className={
                notice.type === "success"
                  ? "text-green-600 dark:text-green-400"
                  : undefined
              }
            >
              {notice.type === "success" && "\u2713 "}
              {notice.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-6 flex-wrap">
          <div>
            <Label className="text-muted-foreground">Account ID</Label>
            <div className="font-mono text-sm">{account?.id || "\u2014"}</div>
          </div>
          <div>
            <Label className="text-muted-foreground">Tier</Label>
            <div>
              <Badge variant={tier === "paid" ? "default" : "outline"}>
                {tier}
              </Badge>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">API Key</Label>
            <div className="font-mono text-sm">
              {account?.key_prefix ? `${account.key_prefix}...` : "\u2014"}
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">Recovery Email</Label>
            <div className="text-sm">
              {account?.recovery_email || account?.email || "(not set)"}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowRotatePanel(!showRotatePanel);
              setShowRecoveryPanel(false);
            }}
          >
            Rotate API key
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowRecoveryPanel(!showRecoveryPanel);
              setShowRotatePanel(false);
            }}
          >
            Update recovery email
          </Button>
          <Button variant="destructive" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>

        {showRotatePanel && (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                Rotating your key will invalidate the current one immediately.
                Update all agents using this key before or after.
              </AlertDescription>
            </Alert>
            <Button variant="destructive" size="sm" onClick={handleRotateKey}>
              Confirm: rotate key
            </Button>
          </div>
        )}

        {showRecoveryPanel && (
          <div className="space-y-2">
            <Label htmlFor="update-recovery">New recovery email</Label>
            <div className="flex gap-2">
              <Input
                id="update-recovery"
                type="email"
                placeholder="new@example.com"
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdateRecovery()}
              />
              <Button onClick={handleUpdateRecovery}>Save</Button>
            </div>
          </div>
        )}

        {newKey && (
          <div className="space-y-2">
            <Alert>
              <AlertDescription className="text-green-600 dark:text-green-400">
                New API key generated. Save it now — not shown again.
              </AlertDescription>
            </Alert>
            <div className="font-mono text-sm text-green-600 dark:text-green-400 bg-muted/50 border rounded-md p-3 break-all">
              {newKey}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
