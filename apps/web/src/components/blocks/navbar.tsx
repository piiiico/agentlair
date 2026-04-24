import { useState, useEffect, useRef } from "react";

import { ChevronDown, Github } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/consts";
import { cn } from "@/lib/utils";

const DOCS_ITEMS = [
  { label: "Overview", href: "/docs" },
  { label: "Getting Started", href: "/getting-started" },
  { label: "Concepts", href: "/docs/concepts" },
  { label: "API Reference", href: "/docs/api-reference" },
  { label: "Audit Logger", href: "/docs/audit-logger" },
  { label: "Vault Docs", href: "/docs/vault" },
];

const ITEMS = [
  { label: "Playground", href: "/playground" },
  { label: "Pods", href: "/pods" },
  { label: "Vault", href: "/vault" },
  { label: "Explore", href: "/explore" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
  { label: "Start Free", href: "/register" },
];

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [pathname, setPathname] = useState("");
  const docsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (docsRef.current && !docsRef.current.contains(e.target as Node)) {
        setIsDocsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <section
      className={cn(
        "bg-background/70 absolute left-1/2 z-50 w-[min(90%,700px)] -translate-x-1/2 rounded-4xl border backdrop-blur-md transition-all duration-300",
        "top-5 lg:top-12",
      )}
    >
      <div className="flex items-center justify-between px-6 py-3">
        <a href="/" className="flex shrink-0 items-center gap-2">
          <span className="font-display text-foreground text-lg font-bold tracking-tight">
            AgentLair
          </span>
        </a>

        {/* Desktop Navigation */}
        <nav className="flex items-center gap-1 max-lg:hidden">
          {ITEMS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={cn(
                "relative bg-transparent px-1.5 text-sm font-medium transition-opacity hover:opacity-75",
                pathname === link.href && "text-muted-foreground",
              )}
            >
              {link.label}
            </a>
          ))}
          {/* Docs dropdown */}
          <div ref={docsRef} className="relative">
            <button
              onClick={() => setIsDocsOpen(!isDocsOpen)}
              className={cn(
                "relative flex items-center gap-0.5 bg-transparent px-1.5 text-sm font-medium transition-opacity hover:opacity-75",
                pathname.startsWith("/docs") && "text-muted-foreground",
              )}
            >
              Docs
              <ChevronDown className={cn("size-3 transition-transform", isDocsOpen && "rotate-180")} />
            </button>
            {isDocsOpen && (
              <div className="bg-background border absolute right-0 top-full mt-2 w-48 rounded-xl p-1 shadow-lg">
                {DOCS_ITEMS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-primary/5",
                      pathname === item.href ? "text-primary" : "text-foreground",
                    )}
                    onClick={() => setIsDocsOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Auth Buttons */}
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="size-4" />
            <span className="sr-only">GitHub</span>
          </a>

          {/* Hamburger Menu Button (Mobile Only) */}
          <button
            className="text-muted-foreground relative flex size-8 lg:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <span className="sr-only">Open main menu</span>
            <div className="absolute top-1/2 left-1/2 block w-[18px] -translate-x-1/2 -translate-y-1/2">
              <span
                aria-hidden="true"
                className={`absolute block h-0.5 w-full rounded-full bg-current transition duration-500 ease-in-out ${isMenuOpen ? "rotate-45" : "-translate-y-1.5"}`}
              ></span>
              <span
                aria-hidden="true"
                className={`absolute block h-0.5 w-full rounded-full bg-current transition duration-500 ease-in-out ${isMenuOpen ? "opacity-0" : ""}`}
              ></span>
              <span
                aria-hidden="true"
                className={`absolute block h-0.5 w-full rounded-full bg-current transition duration-500 ease-in-out ${isMenuOpen ? "-rotate-45" : "translate-y-1.5"}`}
              ></span>
            </div>
          </button>
        </div>
      </div>

      {/* Mobile Menu Navigation */}
      <div
        className={cn(
          "bg-background fixed inset-x-0 top-[calc(100%+1rem)] flex flex-col rounded-2xl border p-6 transition-all duration-300 ease-in-out lg:hidden",
          isMenuOpen
            ? "visible translate-y-0 opacity-100"
            : "invisible -translate-y-4 opacity-0",
        )}
      >
        <nav className="divide-border flex flex-1 flex-col divide-y">
          {ITEMS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={cn(
                "text-foreground hover:text-foreground/80 py-4 text-base font-medium transition-colors first:pt-0 last:pb-0",
                pathname === link.href && "text-muted-foreground",
              )}
              onClick={() => setIsMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="py-4 space-y-1">
            <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Docs</div>
            {DOCS_ITEMS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn(
                  "text-foreground hover:text-foreground/80 block py-1.5 text-sm font-medium transition-colors",
                  pathname === link.href && "text-primary",
                )}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </section>
  );
};
