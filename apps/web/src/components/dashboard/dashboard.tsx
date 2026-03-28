import { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./auth";
import { apiCall } from "./api";
import { Login } from "./components/login";
import { AccountCard } from "./components/account-card";
import { AddressManager } from "./components/address-manager";
import { Compose } from "./components/compose";
import { Inbox, Outbox, ObservationsFeed } from "./components/inbox";
import { Spinner } from "@/components/ui/spinner";

function DashboardContent() {
  const { isAuthenticated, loading } = useAuth();
  const [addresses, setAddresses] = useState<string[]>([]);
  const [addressesLoaded, setAddressesLoaded] = useState(false);

  const loadAddresses = useCallback(async () => {
    const { ok, data } = await apiCall<{ addresses?: string[] }>(
      "/v1/email/addresses"
    );
    setAddresses(ok && data.addresses ? data.addresses : []);
    setAddressesLoaded(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadAddresses();
    }
  }, [isAuthenticated, loadAddresses]);

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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <AccountCard />
      <AddressManager onClaimed={loadAddresses} />
      <Compose addresses={addresses} />
      <Inbox addresses={addresses} />
      <Outbox />
      <ObservationsFeed />
    </div>
  );
}

export function Dashboard() {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
}
