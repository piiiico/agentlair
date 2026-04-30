"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WaitlistState = "idle" | "submitting" | "success" | "error";

export function WaitlistModal({
  tier,
  open,
  onClose,
  idPrefix = "waitlist",
}: {
  tier: string;
  open: boolean;
  onClose: () => void;
  idPrefix?: string;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<WaitlistState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const emailId = `${idPrefix}-email`;
  const companyId = `${idPrefix}-company`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/v1/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, tier: tier.toLowerCase() }),
      });

      if (res.ok) {
        setState("success");
      } else {
        const data = (await res.json()) as { error?: string };
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setState("error");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  };

  const handleClose = () => {
    setEmail("");
    setCompany("");
    setState("idle");
    setErrorMsg("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join the {tier} waitlist</DialogTitle>
          <DialogDescription>
            Checkout is coming soon. Leave your email and we'll reach out first.
          </DialogDescription>
        </DialogHeader>

        {state === "success" ? (
          <div className="py-6 text-center space-y-2">
            <div className="text-2xl">✓</div>
            <p className="font-medium">You're on the list.</p>
            <p className="text-muted-foreground text-sm">
              Check your inbox — a confirmation is on its way.
            </p>
            <Button className="mt-4" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor={emailId}>Work email</Label>
              <Input
                id={emailId}
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={state === "submitting"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={companyId}>
                Company{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id={companyId}
                type="text"
                placeholder="Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={state === "submitting"}
              />
            </div>

            {state === "error" && (
              <p className="text-destructive text-sm">{errorMsg}</p>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={state === "submitting"}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={state === "submitting"}>
                {state === "submitting" ? "Submitting…" : "Join Waitlist"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
