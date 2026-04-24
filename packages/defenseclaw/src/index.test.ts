/**
 * @agentlair/defenseclaw — Unit tests
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createPlugin, scoreTier } from "./index.js";
import type { DefenseClawPluginConfig } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApi() {
  const handlers: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  return {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
    async emit(event: string, ...args: unknown[]) {
      const evtHandlers = handlers[event] ?? [];
      for (const h of evtHandlers) {
        const result = await h(...args);
        if (result !== undefined) return result;
      }
      return undefined;
    },
  };
}

function makeEvent(toolName = "read_file") {
  return { toolName, params: {} };
}

function makeCtx(agentId = "agent-abc") {
  return { agentId, toolName: "read_file" };
}

// ─── scoreTier ────────────────────────────────────────────────────────────────

describe("scoreTier", () => {
  it("returns TRUSTED for score >= 70", () => {
    expect(scoreTier(70)).toBe("TRUSTED");
    expect(scoreTier(100)).toBe("TRUSTED");
    expect(scoreTier(85)).toBe("TRUSTED");
  });

  it("returns CAUTIOUS for score 31-69", () => {
    expect(scoreTier(31)).toBe("CAUTIOUS");
    expect(scoreTier(50)).toBe("CAUTIOUS");
    expect(scoreTier(69)).toBe("CAUTIOUS");
  });

  it("returns COLD_START for score <= 30", () => {
    expect(scoreTier(30)).toBe("COLD_START");
    expect(scoreTier(0)).toBe("COLD_START");
    expect(scoreTier(15)).toBe("COLD_START");
  });
});

// ─── createPlugin ─────────────────────────────────────────────────────────────

describe("createPlugin", () => {
  // Mock fetch globally for tests
  const originalFetch = globalThis.fetch;

  function mockTrustApi(score: number) {
    globalThis.fetch = async (_url: string | URL | Request) => {
      return new Response(
        JSON.stringify({ trusted: score >= 70, score }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };
  }

  function mockTrustApiError() {
    globalThis.fetch = async () => {
      throw new Error("Network unreachable");
    };
  }

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("allows TRUSTED agent (score >= 70)", async () => {
    mockTrustApi(85);
    const plugin = createPlugin({ trust: { apiKey: "test-key" } });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), makeCtx());
    expect(result).toBeUndefined(); // no block = allow
  });

  it("audits CAUTIOUS agent (score 31-69) on safe tool", async () => {
    mockTrustApi(50);
    const consoleSpy = mock(() => {});
    const origWarn = console.warn;
    console.warn = consoleSpy;

    const plugin = createPlugin({ trust: { apiKey: "test-key" } });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent("read_file"), makeCtx());

    expect(result).toBeUndefined(); // audit = allow but log
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain("AUDIT");

    console.warn = origWarn;
  });

  it("blocks CAUTIOUS agent calling high-risk tool", async () => {
    mockTrustApi(50);
    const plugin = createPlugin({ trust: { apiKey: "test-key" } });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent("bash"), makeCtx()) as any;
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("COLD_START");
  });

  it("blocks COLD_START agent (score <= 30) by default", async () => {
    mockTrustApi(25);
    const plugin = createPlugin({ trust: { apiKey: "test-key" } });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent("read_file"), makeCtx()) as any;
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("COLD_START");
    expect(result?.blockReason).toContain("agent-abc");
  });

  it("allows COLD_START when policy overridden to allow", async () => {
    mockTrustApi(20);
    const plugin = createPlugin({
      trust: { apiKey: "test-key" },
      policy: { COLD_START: "allow" },
    });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), makeCtx());
    expect(result).toBeUndefined();
  });

  it("fails open when trust API errors and blockOnFailure=false", async () => {
    mockTrustApiError();
    const plugin = createPlugin({ trust: { apiKey: "test-key" }, blockOnFailure: false });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), makeCtx());
    expect(result).toBeUndefined();
  });

  it("fails closed when trust API errors and blockOnFailure=true", async () => {
    mockTrustApiError();
    const plugin = createPlugin({ trust: { apiKey: "test-key" }, blockOnFailure: true });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), makeCtx()) as any;
    expect(result?.block).toBe(true);
  });

  it("blocks when no agentId and blockOnFailure=true", async () => {
    const plugin = createPlugin({ blockOnFailure: true });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), { toolName: "read_file" }) as any;
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("agent identity not present");
  });

  it("allows when no agentId and blockOnFailure=false", async () => {
    const plugin = createPlugin({ blockOnFailure: false });
    const api = makeApi();
    plugin(api);
    const result = await api.emit("before_tool_call", makeEvent(), { toolName: "read_file" });
    expect(result).toBeUndefined();
  });
});

function afterAll(fn: () => void) {
  // Bun test cleanup
  fn();
}
