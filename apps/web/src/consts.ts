export const SITE_TITLE = "AgentLair — The Infrastructure Platform for AI Agents";
export const SITE_DESCRIPTION =
  "Email, encrypted vault, calendar, multi-tenant pods, and real-time coordination for AI agents — all through a simple REST API.";

export const GITHUB_URL = "https://github.com/piiiico/agentlair";

export const SITE_METADATA = {
  title: {
    default: "AgentLair — The Infrastructure Platform for AI Agents",
    template: "%s | AgentLair",
  },
  description:
    "Email, encrypted vault, calendar, multi-tenant pods, and real-time coordination for AI agents — all through a simple REST API.",
  keywords: [
    "AI agents",
    "agent platform",
    "AI email",
    "agent vault",
    "agent calendar",
    "AI infrastructure",
    "agent API",
    "autonomous agents",
    "agent isolation",
    "MCP",
    "agent protocol",
    "encrypted storage",
    "multi-tenant agents",
  ],
  authors: [{ name: "AgentLair" }],
  creator: "AgentLair",
  publisher: "AgentLair",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.svg" }],
  },
  openGraph: {
    title: "AgentLair — The Infrastructure Platform for AI Agents",
    description:
      "Email, encrypted vault, calendar, multi-tenant pods, and real-time coordination for AI agents.",
    siteName: "AgentLair",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "AgentLair — The API Platform for AI Agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentLair — The Infrastructure Platform for AI Agents",
    description:
      "Email, encrypted vault, calendar, multi-tenant pods, and real-time coordination for AI agents.",
    images: ["/og-image.jpg"],
  },
};
