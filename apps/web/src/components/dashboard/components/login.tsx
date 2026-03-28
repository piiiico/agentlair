import { useState } from "react";
import { useAuth } from "../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

type NoticeType = "info" | "success" | "error";
interface Notice {
  type: NoticeType;
  message: string;
}

export function Login() {
  const { loginWithApiKey, requestMagicLink } = useAuth();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleApiKeyLogin = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setNotice({ type: "error", message: "Enter your API key." });
      return;
    }
    setLoading(true);
    setNotice({ type: "info", message: "Verifying..." });
    const error = await loginWithApiKey(key);
    setLoading(false);
    if (error) {
      setNotice({ type: "error", message: error });
    }
    // On success, auth state changes and parent switches to dashboard
  };

  const handleMagicLink = async () => {
    const email = emailInput.trim();
    if (!email) {
      setNotice({ type: "error", message: "Enter your recovery email." });
      return;
    }
    setLoading(true);
    setNotice({ type: "info", message: "Sending magic link..." });
    const error = await requestMagicLink(email);
    setLoading(false);
    if (error) {
      setNotice({ type: "error", message: error });
    } else {
      setNotice({
        type: "success",
        message: `Magic link sent to ${email}. Check your inbox — expires in 15 minutes.`,
      });
    }
  };

  const noticeVariant = notice?.type === "error" ? "destructive" : "default";

  return (
    <div className="mx-auto max-w-md py-12 px-4">
      <h2 className="text-xl font-semibold mb-1">Dashboard</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Sign in to manage your addresses, read messages, and send email.
      </p>

      {notice && (
        <Alert variant={noticeVariant} className="mb-4">
          {loading && <Spinner className="size-3.5" />}
          <AlertDescription
            className={
              notice.type === "success"
                ? "text-green-600 dark:text-green-400"
                : undefined
            }
          >
            {notice.message}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="apikey">
        <TabsList className="w-full">
          <TabsTrigger value="apikey" className="flex-1">
            API Key
          </TabsTrigger>
          <TabsTrigger value="magic" className="flex-1">
            Magic Link
          </TabsTrigger>
        </TabsList>

        <TabsContent value="apikey">
          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apikey-input">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="apikey-input"
                    placeholder="al_live_..."
                    className="font-mono"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleApiKeyLogin()}
                  />
                  <Button onClick={handleApiKeyLogin} disabled={loading}>
                    Sign in
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Don&apos;t have a key?{" "}
                <a
                  href="/#web-signup"
                  className="text-primary underline underline-offset-4 hover:text-primary/80"
                >
                  Create a free account
                </a>{" "}
                on the homepage.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="magic">
          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recovery-email-input">Recovery email</Label>
                <div className="flex gap-2">
                  <Input
                    id="recovery-email-input"
                    type="email"
                    placeholder="you@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleMagicLink()}
                  />
                  <Button onClick={handleMagicLink} disabled={loading}>
                    Send link
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Requires a recovery email set on your account.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-sm text-muted-foreground mt-6 text-center space-x-2">
        <a href="/" className="text-primary hover:underline">
          Back to agentlair.dev
        </a>
        <span>&middot;</span>
        <a href="/getting-started" className="text-primary hover:underline">
          Getting started guide
        </a>
        <span>&middot;</span>
        <a href="/integrations" className="text-primary hover:underline">
          Integrations
        </a>
      </p>
    </div>
  );
}
