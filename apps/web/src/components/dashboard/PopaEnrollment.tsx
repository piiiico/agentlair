import { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./auth";
import { apiCall } from "./api";
import { Login } from "./components/login";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

type EnrollState =
  | { status: "loading" }
  | { status: "attested" }
  | { status: "not_enrolled" }
  | { status: "enrolled_pending" }
  | { status: "error"; message: string };

function PopaEnrollmentContent() {
  const { isAuthenticated, loading, account } = useAuth();
  const [state, setState] = useState<EnrollState>({ status: "loading" });
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const did = account?.id ? `did:web:agentlair.dev:agents:${account.id}` : null;
  const encodedDid = did ? encodeURIComponent(did) : null;

  const checkEnrollment = useCallback(async () => {
    if (!encodedDid) return;
    setState({ status: "loading" });
    const { ok, status } = await apiCall(`/v1/popa/${encodedDid}`);
    if (ok) {
      setState({ status: "attested" });
    } else if (status === 404) {
      setState({ status: "not_enrolled" });
    } else {
      setState({ status: "error", message: "Could not check enrollment status." });
    }
  }, [encodedDid]);

  useEffect(() => {
    if (isAuthenticated && encodedDid) {
      checkEnrollment();
    } else if (!loading && !isAuthenticated) {
      setState({ status: "not_enrolled" });
    }
  }, [isAuthenticated, loading, encodedDid, checkEnrollment]);

  const handleEnroll = useCallback(async () => {
    if (!did) return;
    setActionLoading(true);
    setNotice(null);
    const { ok, data } = await apiCall<{ message?: string }>("/v1/popa/enroll", {
      method: "POST",
      body: JSON.stringify({ agent_did: did }),
    });
    setActionLoading(false);
    if (ok) {
      setState({ status: "enrolled_pending" });
      setNotice({
        type: "success",
        message: "Enrolled. First attestation arrives within 24 hours.",
      });
    } else {
      setNotice({
        type: "error",
        message: (data as { message?: string }).message || "Enrollment failed.",
      });
    }
  }, [did]);

  const handleRevoke = useCallback(async () => {
    if (!encodedDid) return;
    setActionLoading(true);
    setNotice(null);
    const { ok, data } = await apiCall<{ message?: string }>(
      `/v1/popa/enroll/${encodedDid}`,
      { method: "DELETE" }
    );
    setActionLoading(false);
    if (ok) {
      setState({ status: "not_enrolled" });
      setNotice({ type: "success", message: "Enrollment revoked." });
    } else {
      setNotice({
        type: "error",
        message: (data as { message?: string }).message || "Revocation failed.",
      });
    }
  }, [encodedDid]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const isEnrolled =
    state.status === "attested" || state.status === "enrolled_pending";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Proof of Presence Attestation</h1>
        <p className="text-muted-foreground mt-1">
          Enroll your agent DID to get daily attestations written to the SCITT
          transparency log.
        </p>
      </div>

      {notice && (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertDescription
            className={
              notice.type === "success"
                ? "text-green-600 dark:text-green-400"
                : undefined
            }
          >
            {notice.type === "success" && "✓ "}
            {notice.message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Your Agent DID
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="font-mono text-sm bg-muted/50 border rounded-md p-3 break-all">
            {did ?? "—"}
          </div>

          {state.status === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Checking enrollment…
            </div>
          )}

          {state.status !== "loading" && state.status !== "error" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label className="text-muted-foreground">Status</Label>
                {isEnrolled ? (
                  <Badge className="bg-green-600 text-white">Enrolled</Badge>
                ) : (
                  <Badge variant="outline">Not enrolled</Badge>
                )}
                {state.status === "enrolled_pending" && (
                  <span className="text-xs text-muted-foreground">
                    (first attestation pending)
                  </span>
                )}
                {state.status === "attested" && did && (
                  <a
                    href={`/popa/${encodedDid}`}
                    className="text-xs text-muted-foreground underline underline-offset-2"
                  >
                    view attestations →
                  </a>
                )}
              </div>

              {isEnrolled ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Revoking…" : "Revoke enrollment"}
                </Button>
              ) : (
                <Button onClick={handleEnroll} disabled={actionLoading}>
                  {actionLoading ? "Enrolling…" : "Enroll"}
                </Button>
              )}
            </div>
          )}

          {state.status === "error" && (
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Enrolled DIDs get one attestation per day on the{" "}
        <a href="/specs/popa" className="underline underline-offset-2">
          SCITT log
        </a>
        . Share your{" "}
        {did ? (
          <a
            href={`/popa/${encodedDid}`}
            className="underline underline-offset-2"
          >
            PoPA page
          </a>
        ) : (
          "PoPA page"
        )}{" "}
        to prove consistent uptime.
      </p>
    </div>
  );
}

export function PopaEnrollment() {
  return (
    <AuthProvider>
      <PopaEnrollmentContent />
    </AuthProvider>
  );
}
