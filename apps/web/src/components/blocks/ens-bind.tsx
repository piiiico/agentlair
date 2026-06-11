"use client";

/**
 * ENS Bind — ENSIP-25 agent binding UI
 *
 * Flow:
 * 1. Connect wallet (window.ethereum)
 * 2. User enters / selects their ENS name
 * 3. Fetch ERC-8004 agent tokens owned by the wallet
 * 4. User picks an agent
 * 5. Build the ENSIP-25 text record key
 * 6. Submit setText transaction via ENS Public Resolver
 * 7. Show success + verify link
 */

import { useState, useEffect, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  namehash,
  type Hash,
} from "viem";
import { mainnet } from "viem/chains";
import { buildTextRecordKey } from "@/lib/ensip25";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Constants ────────────────────────────────────────────────────────────────

// AgentLair ERC-8004 registry (Ethereum mainnet)
const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const REGISTRY_CHAIN_ID = 1n; // Ethereum mainnet

// ENS Public Resolver (mainnet)
const ENS_PUBLIC_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63" as const;

// ENS Registry
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

// ABIs
const ERC721_ENUMERABLE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ENS_REGISTRY_ABI = [
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ENS_RESOLVER_ABI = [
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "connect" | "pick-name" | "pick-agent" | "confirm" | "pending" | "done" | "error";

// ─── Public client (read-only) ────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth-mainnet.public.blastapi.io"),
});

// ─── Component ────────────────────────────────────────────────────────────────

export function EnsBind() {
  const [step, setStep] = useState<Step>("connect");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [ensName, setEnsName] = useState("");
  const [ensNameInput, setEnsNameInput] = useState("");
  const [agentIds, setAgentIds] = useState<bigint[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  // ── Connect Wallet ────────────────────────────────────────────────────────

  const connectWallet = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setError("No wallet detected. Install MetaMask or another Web3 wallet.");
      setStep("error");
      return;
    }
    try {
      const [addr] = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAccount(addr as `0x${string}`);

      // Auto reverse-lookup ENS name
      try {
        const name = await publicClient.getEnsName({ address: addr as `0x${string}` });
        if (name) {
          setEnsNameInput(name);
        }
      } catch {
        // Reverse lookup not available — user enters manually
      }

      setStep("pick-name");
    } catch (e: any) {
      setError(`Wallet connection failed: ${e.message}`);
      setStep("error");
    }
  }, []);

  // ── Confirm ENS Name ──────────────────────────────────────────────────────

  const confirmEnsName = useCallback(async () => {
    const name = ensNameInput.trim().toLowerCase();
    if (!name.endsWith(".eth") && !name.includes(".")) {
      setError("Enter a valid ENS name (e.g., yourname.eth)");
      return;
    }

    // Verify that the connected wallet owns this ENS name
    try {
      const node = namehash(name);
      const resolver = await publicClient.readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "resolver",
        args: [node],
      });
      if (!resolver || resolver === "0x0000000000000000000000000000000000000000") {
        setError(`ENS name "${name}" has no resolver set. Is this name registered?`);
        return;
      }

      const addr = await publicClient.getEnsAddress({ name }).catch(() => null);
      setResolvedAddress(addr || null);
    } catch {
      // Non-critical — proceed anyway
    }

    setEnsName(name);
    setError(null);
    setLoadingAgents(true);
    setStep("pick-agent");

    // Fetch agent IDs owned by the connected wallet
    try {
      if (!account) return;
      const balance = await publicClient.readContract({
        address: ERC8004_REGISTRY,
        abi: ERC721_ENUMERABLE_ABI,
        functionName: "balanceOf",
        args: [account],
      });

      const ids: bigint[] = [];
      const maxToFetch = balance > 50n ? 50n : balance; // Cap at 50 to avoid timeouts
      for (let i = 0n; i < maxToFetch; i++) {
        const tokenId = await publicClient.readContract({
          address: ERC8004_REGISTRY,
          abi: ERC721_ENUMERABLE_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [account, i],
        });
        ids.push(tokenId);
      }
      setAgentIds(ids);
    } catch (e: any) {
      setError(`Could not fetch agent IDs: ${e.message?.slice(0, 100)}`);
    } finally {
      setLoadingAgents(false);
    }
  }, [ensNameInput, account]);

  // ── Select Agent → Confirm ────────────────────────────────────────────────

  const selectAgent = useCallback((agentId: bigint) => {
    setSelectedAgent(agentId);
    setStep("confirm");
  }, []);

  // ── Submit binding ────────────────────────────────────────────────────────

  const submitBinding = useCallback(async () => {
    if (!account || !selectedAgent || !ensName) return;

    setStep("pending");
    setError(null);

    try {
      const walletClient = createWalletClient({
        chain: mainnet,
        transport: custom(window.ethereum!),
      });

      // Ensure wallet is on mainnet
      const chainId = await walletClient.getChainId();
      if (chainId !== 1) {
        await window.ethereum!.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1" }],
        });
      }

      const node = namehash(ensName);
      const textKey = buildTextRecordKey(REGISTRY_CHAIN_ID, ERC8004_REGISTRY, selectedAgent.toString());

      const hash = await walletClient.writeContract({
        address: ENS_PUBLIC_RESOLVER,
        abi: ENS_RESOLVER_ABI,
        functionName: "setText",
        args: [node, textKey, "1"],
        account,
      });

      setTxHash(hash);
      setStep("done");
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes("rejected")) {
        setError("Transaction cancelled.");
      } else {
        setError(`Transaction failed: ${e.message?.slice(0, 150)}`);
      }
      setStep("error");
    }
  }, [account, selectedAgent, ensName]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const textKey =
    selectedAgent !== null
      ? buildTextRecordKey(REGISTRY_CHAIN_ID, ERC8004_REGISTRY, selectedAgent.toString())
      : null;

  return (
    <div className="max-w-lg mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted px-3 py-1 rounded-full">
          ENSIP-25 · ERC-8004 · AgentLair
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Bind ENS → Agent</h1>
        <p className="text-muted-foreground text-sm">
          Link your ENS name to an AgentLair agent on-chain.
          Any service can then verify the binding with{" "}
          <code className="bg-muted px-1 rounded text-xs">npx ensip25-verify</code>.
        </p>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1">
        {(["connect", "pick-name", "pick-agent", "confirm", "done"] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              step === s
                ? "bg-primary"
                : ["connect", "pick-name", "pick-agent", "confirm", "done"].indexOf(step) > i
                ? "bg-primary/40"
                : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step: Connect */}
      {step === "connect" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 1 — Connect Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You'll need a wallet that owns an ENS name and at least one AgentLair agent token.
            </p>
            <Button onClick={connectWallet} className="w-full">
              Connect Wallet
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step: Pick ENS name */}
      {step === "pick-name" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 2 — Your ENS Name</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connected as{" "}
              <code className="bg-muted px-1 rounded text-xs">
                {account?.slice(0, 6)}…{account?.slice(-4)}
              </code>
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">ENS name</label>
              <input
                type="text"
                value={ensNameInput}
                onChange={(e) => setEnsNameInput(e.target.value)}
                placeholder="yourname.eth"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                Must be an ENS name you own on Ethereum mainnet.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={confirmEnsName} className="w-full" disabled={!ensNameInput.trim()}>
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step: Pick agent */}
      {step === "pick-agent" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 3 — Pick an Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Binding <strong>{ensName}</strong> to an agent in the AgentLair registry.
            </p>
            {resolvedAddress && (
              <p className="text-xs text-muted-foreground">
                → resolves to{" "}
                <code className="bg-muted px-1 rounded">{resolvedAddress.slice(0, 10)}…</code>
              </p>
            )}
            {loadingAgents && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Loading your agent tokens…
              </div>
            )}
            {!loadingAgents && agentIds.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No AgentLair agent tokens found for this wallet on Ethereum mainnet.
                </p>
                <a
                  href="https://agentlair.dev/getting-started"
                  className="text-sm text-primary hover:underline"
                >
                  Create an agent →
                </a>
              </div>
            )}
            {!loadingAgents && agentIds.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">
                  {agentIds.length} agent{agentIds.length !== 1 ? "s" : ""} found:
                </p>
                <div className="grid gap-2">
                  {agentIds.map((id) => (
                    <button
                      key={id.toString()}
                      onClick={() => selectAgent(id)}
                      className="flex items-center justify-between border rounded-lg px-4 py-3 text-sm hover:bg-muted transition-colors text-left"
                    >
                      <span>Agent #{id.toString()}</span>
                      <span className="text-muted-foreground text-xs">Select →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>
        </Card>
      )}

      {/* Step: Confirm */}
      {step === "confirm" && selectedAgent !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Step 4 — Confirm Binding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-4 space-y-2 text-sm font-mono">
              <div>
                <span className="text-muted-foreground">ENS name: </span>
                <span>{ensName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Agent ID: </span>
                <span>#{selectedAgent.toString()}</span>
              </div>
              <div className="break-all">
                <span className="text-muted-foreground">Text key: </span>
                <span className="text-xs">{textKey}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Value: </span>
                <span>"1"</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This will call <code>setText</code> on the ENS Public Resolver. You'll sign one
              transaction. Gas cost: ~30k gas (≈ $1 at 20 Gwei).
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("pick-agent")} className="flex-1">
                Back
              </Button>
              <Button onClick={submitBinding} className="flex-1">
                Sign & Bind
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Pending */}
      {step === "pending" && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <svg className="animate-spin h-10 w-10 mx-auto text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm text-muted-foreground">Waiting for transaction confirmation…</p>
          </CardContent>
        </Card>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="text-center space-y-2">
              <div className="text-4xl">✅</div>
              <h2 className="text-xl font-semibold">Binding confirmed!</h2>
              <p className="text-sm text-muted-foreground">
                <strong>{ensName}</strong> is now bound to agent #{selectedAgent?.toString()} on-chain.
              </p>
            </div>
            {txHash && (
              <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                <p className="text-muted-foreground text-xs">Transaction</p>
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline break-all"
                >
                  {txHash}
                </a>
              </div>
            )}
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <p className="font-medium text-xs text-muted-foreground">Verify the binding</p>
              <code className="block bg-muted px-3 py-2 rounded text-xs break-all">
                npx ensip25-verify {ensName} {ERC8004_REGISTRY} {selectedAgent?.toString()} --pretty
              </code>
              <p className="text-xs text-muted-foreground">
                Wait ~30s for the transaction to confirm on-chain before verifying.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Error */}
      {step === "error" && (
        <Card>
          <CardContent className="py-8 space-y-4 text-center">
            <div className="text-4xl">❌</div>
            <p className="text-sm text-red-500">{error}</p>
            <Button variant="outline" onClick={() => { setStep("connect"); setError(null); }}>
              Start over
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground">
        Built on{" "}
        <a href="https://docs.ens.domains/ensip/25" target="_blank" className="underline hover:text-foreground">
          ENSIP-25
        </a>{" "}
        ·{" "}
        <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" className="underline hover:text-foreground">
          ERC-8004
        </a>
        {" "}·{" "}
        <a href="https://agentlair.dev" className="underline hover:text-foreground">
          AgentLair
        </a>
      </p>
    </div>
  );
}
