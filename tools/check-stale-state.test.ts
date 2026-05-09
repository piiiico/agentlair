/**
 * check-stale-state — classifier + parser + fix-script tests.
 *
 * Why this exists: the classifier *is* the tool — anything mis-classified
 * either ships an artifact that shouldn't (build outputs as commits) or
 * holds back a real edit the agent intended to publish (drafts mistaken
 * for commit-as-is). These tests pin the surface so future widenings
 * can't silently regress an actual recurring failure mode.
 *
 * Run: bun test tools/check-stale-state.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
  buildFixScript,
  classify,
  groupByCategory,
  parseArgs,
  parsePorcelain,
  type Entry,
} from "./check-stale-state";

describe("classify — known surfaces", () => {
  test("blog-content modified", () => {
    const c = classify("apps/web/src/content/blog/foo.md", false);
    expect(c.category).toBe("blog-content");
    expect(c.action).toBe("commit-as-is");
  });

  test("page route modified is page-tracked", () => {
    const c = classify("apps/web/src/pages/eu-ai-act.mdx", false);
    expect(c.category).toBe("page-tracked");
    expect(c.action).toBe("commit-as-is");
  });

  test("page route untracked is page-untracked", () => {
    const c = classify("apps/web/src/pages/clarity-act.astro", true);
    expect(c.category).toBe("page-untracked");
    expect(c.action).toBe("commit-as-is");
  });

  test("component change", () => {
    const c = classify(
      "apps/web/src/components/blocks/eu-ai-act-assess.tsx",
      false,
    );
    expect(c.category).toBe("component");
    expect(c.action).toBe("commit-as-is");
  });

  test("layout change", () => {
    const c = classify("apps/web/src/layouts/DefaultLayout.astro", false);
    expect(c.category).toBe("layout");
    expect(c.action).toBe("commit-as-is");
  });

  test("package src", () => {
    const c = classify("packages/spa-verifier/src/cli.ts", false);
    expect(c.category).toBe("package-impl");
    expect(c.action).toBe("commit-as-is");
  });

  test("package README", () => {
    const c = classify("packages/bcc-primitive/README.md", true);
    expect(c.category).toBe("package-doc");
    expect(c.action).toBe("commit-as-is");
  });

  test("package CHANGELOG", () => {
    const c = classify("packages/spa-verifier/CHANGELOG.md", true);
    expect(c.category).toBe("package-doc");
    expect(c.action).toBe("commit-as-is");
  });

  test("package manifest", () => {
    const c = classify("packages/worker/package.json", false);
    expect(c.category).toBe("package-impl");
    expect(c.action).toBe("commit-as-is");
  });

  test("package test", () => {
    const c = classify(
      "packages/worker/src/routes/stripe.test.ts",
      true,
    );
    expect(c.category).toBe("package-impl");
  });

  test("tool impl + test", () => {
    expect(classify("tools/preflight-deploy-guard.ts", false).category).toBe(
      "tool-impl",
    );
    expect(
      classify("tools/preflight-deploy-guard.test.ts", true).category,
    ).toBe("tool-test");
  });

  test("docs change", () => {
    const c = classify("docs/integrations/flue.md", true);
    expect(c.category).toBe("docs");
    expect(c.action).toBe("commit-as-is");
  });

  test("audit report at root", () => {
    const c = classify("conversion-path-audit.md", true);
    expect(c.category).toBe("audit-report");
    expect(c.action).toBe("commit-as-is");
  });

  test("content/social", () => {
    const c = classify("content/social/five-eyes-linkedin.md", true);
    expect(c.category).toBe("content-research");
    expect(c.action).toBe("commit-as-is");
  });

  test("whitepaper", () => {
    const c = classify(
      "whitepaper/behavioral-trust-agentic-economy.md",
      false,
    );
    expect(c.category).toBe("content-research");
    expect(c.action).toBe("commit-as-is");
  });

  test("root .gitignore", () => {
    const c = classify(".gitignore", false);
    expect(c.category).toBe("config");
    expect(c.action).toBe("commit-as-is");
  });

  test("app-level package.json", () => {
    const c = classify("apps/web/package.json", false);
    expect(c.category).toBe("config");
    expect(c.action).toBe("commit-as-is");
  });

  test("app-level tsconfig", () => {
    const c = classify("apps/web/tsconfig.json", false);
    expect(c.category).toBe("config");
  });

  test("app-level astro.config.mjs", () => {
    const c = classify("apps/web/astro.config.mjs", false);
    expect(c.category).toBe("config");
  });
});

describe("classify — never-commit surfaces", () => {
  test("dist-bundle build output", () => {
    const c = classify("packages/worker/dist-bundle/index.js", true);
    expect(c.category).toBe("build-artifact");
    expect(c.action).toBe("gitignore-or-revert");
  });

  test("nested node_modules", () => {
    const c = classify(
      "packages/bcc-primitive/node_modules/foo/index.js",
      true,
    );
    expect(c.category).toBe("build-artifact");
    expect(c.action).toBe("gitignore-or-revert");
  });

  test("foundry cache", () => {
    const c = classify(
      "packages/bcc-primitive/contracts/cache/solidity-files-cache.json",
      true,
    );
    expect(c.category).toBe("build-artifact");
    expect(c.action).toBe("gitignore-or-revert");
  });

  test("foundry out", () => {
    const c = classify(
      "packages/bcc-primitive/contracts/out/CBP.sol/CBP.json",
      true,
    );
    expect(c.category).toBe("build-artifact");
    expect(c.action).toBe("gitignore-or-revert");
  });

  test(".tsbuildinfo", () => {
    const c = classify("apps/web/tsconfig.tsbuildinfo", true);
    expect(c.action).toBe("gitignore-or-revert");
  });

  test(".pipeline directory", () => {
    const c = classify(".pipeline/foo/output.md", true);
    expect(c.action).toBe("gitignore-or-revert");
  });
});

describe("classify — drafts and scratch", () => {
  test("drafts/ dir", () => {
    const c = classify("drafts/draft-aamdal-rats.md", true);
    expect(c.category).toBe("draft-content");
    expect(c.action).toBe("keep-WIP");
  });

  test("blog/drafts/ nested", () => {
    const c = classify("blog/drafts/post-x.md", true);
    expect(c.category).toBe("draft-content");
    expect(c.action).toBe("keep-WIP");
  });

  test("untracked .html scratch (unless under known surface)", () => {
    const c = classify("scratch/notes.html", true);
    expect(c.category).toBe("draft-content");
    expect(c.action).toBe("keep-WIP");
  });
});

describe("classify — unknown falls to inspect", () => {
  test("random script", () => {
    const c = classify("scripts/foo.sh", true);
    expect(c.category).toBe("unknown");
    expect(c.action).toBe("inspect-manually");
  });

  test("unfamiliar extension", () => {
    const c = classify("data/dump.csv", false);
    expect(c.category).toBe("unknown");
  });
});

describe("parsePorcelain", () => {
  test("empty input", () => {
    expect(parsePorcelain("")).toEqual([]);
  });

  test("untracked + modified mix", () => {
    const input = [
      " M apps/web/src/content/blog/foo.md",
      "?? apps/web/src/pages/new.astro",
      "MM tools/preflight-deploy-guard.ts",
    ].join("\n");
    const out = parsePorcelain(input);
    expect(out.length).toBe(3);
    expect(out[0]!.untracked).toBe(false);
    expect(out[0]!.path).toBe("apps/web/src/content/blog/foo.md");
    expect(out[1]!.untracked).toBe(true);
    expect(out[1]!.category).toBe("page-untracked");
    expect(out[2]!.status).toBe("MM");
  });

  test("rename keeps new path", () => {
    const input = "R  old/name.ts -> new/name.ts";
    const out = parsePorcelain(input);
    expect(out.length).toBe(1);
    expect(out[0]!.path).toBe("new/name.ts");
  });

  test("quoted path with space", () => {
    const input = `?? "path with spaces/foo.md"`;
    const out = parsePorcelain(input);
    expect(out.length).toBe(1);
    expect(out[0]!.path).toBe("path with spaces/foo.md");
  });
});

describe("buildFixScript", () => {
  function entry(path: string, untracked = true): Entry {
    const c = classify(path, untracked);
    return {
      status: untracked ? "??" : " M",
      path,
      untracked,
      category: c.category,
      action: c.action,
      reason: c.reason,
    };
  }

  test("empty list yields a no-op script with the no-push comment", () => {
    const out = buildFixScript([]);
    expect(out).toContain("set -euo pipefail");
    expect(out).toContain("no commit-as-is entries");
    expect(out).not.toContain("git push origin main\n");
  });

  test("groups commits by category in deterministic order", () => {
    const entries = [
      entry("packages/spa-verifier/src/cli.ts", false),
      entry("apps/web/src/content/blog/post.md", false),
      entry("apps/web/src/pages/new.astro", true),
    ];
    const out = buildFixScript(entries);
    const blogIdx = out.indexOf("# blog-content");
    const pageIdx = out.indexOf("# page-untracked");
    const pkgIdx = out.indexOf("# package-impl");
    expect(blogIdx).toBeGreaterThanOrEqual(0);
    expect(pageIdx).toBeGreaterThan(blogIdx);
    expect(pkgIdx).toBeGreaterThan(pageIdx);
    expect(out).toContain("git push origin main");
  });

  test("build artifacts go to the gitignore comment block, not git add", () => {
    const entries = [entry("packages/worker/dist-bundle/index.js")];
    const out = buildFixScript(entries);
    expect(out).toContain("# build artifacts — add to .gitignore");
    expect(out).toContain("packages/worker/dist-bundle/index.js");
    expect(out).not.toMatch(/git add[^\n]*dist-bundle/);
  });

  test("WIP drafts go to keep-WIP comment block", () => {
    const entries = [entry("drafts/something.md")];
    const out = buildFixScript(entries);
    expect(out).toContain("# WIP/draft — leave alone");
    expect(out).toContain("drafts/something.md");
    expect(out).not.toMatch(/git add[^\n]*drafts\/something/);
  });

  test("unknown entries go to inspect comment block", () => {
    const entries = [entry("data/random.bin")];
    const out = buildFixScript(entries);
    expect(out).toContain("# inspect manually");
  });

  test("paths with single quotes are shell-escaped", () => {
    const entries = [entry("apps/web/src/content/blog/it's-a-post.md", false)];
    const out = buildFixScript(entries);
    expect(out).toContain(`'apps/web/src/content/blog/it'\\''s-a-post.md'`);
  });
});

describe("groupByCategory", () => {
  test("collapses duplicates by category", () => {
    const entries: Entry[] = [
      "apps/web/src/content/blog/a.md",
      "apps/web/src/content/blog/b.md",
      "apps/web/src/pages/c.astro",
    ].map((p) => {
      const c = classify(p, true);
      return {
        status: "??",
        path: p,
        untracked: true,
        category: c.category,
        action: c.action,
        reason: c.reason,
      };
    });
    const g = groupByCategory(entries);
    expect(g["blog-content"]?.length).toBe(2);
    expect(g["page-untracked"]?.length).toBe(1);
  });
});

describe("parseArgs", () => {
  test("default threshold is 5", () => {
    expect(parseArgs([]).threshold).toBe(5);
  });

  test("--threshold N", () => {
    expect(parseArgs(["--threshold", "12"]).threshold).toBe(12);
  });

  test("--threshold=N", () => {
    expect(parseArgs(["--threshold=20"]).threshold).toBe(20);
  });

  test("--json sets json", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  test("--fix-script sets fixScript", () => {
    expect(parseArgs(["--fix-script"]).fixScript).toBe(true);
  });

  test("ignores garbage threshold", () => {
    expect(parseArgs(["--threshold", "not-a-number"]).threshold).toBe(5);
  });
});
