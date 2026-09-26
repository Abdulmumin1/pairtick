import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env (tiny parser, no dependency)
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Fallback: credentials written by `npx @cometchat/skills-cli@3 provision run`
let provisioned = {};
const ccPath = resolve(process.cwd(), ".cometchat/config.json");
if (existsSync(ccPath)) {
  try {
    provisioned = JSON.parse(readFileSync(ccPath, "utf8"));
  } catch {}
}

export const config = {
  port: Number(process.env.PORT || 8787),
  appId: process.env.COMETCHAT_APP_ID || provisioned.appId || "",
  region: process.env.COMETCHAT_REGION || provisioned.region || "",
  authKey: process.env.COMETCHAT_AUTH_KEY || provisioned.authKey || "",
  restKey: process.env.COMETCHAT_REST_API_KEY || process.env.COMET_REST_KEY || "",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiBase: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
};
// PAIRTICK_LLM=mock|gemini|openai|anthropic forces a provider; otherwise auto-detect.
config.llm =
  process.env.PAIRTICK_LLM ||
  (config.geminiKey ? "gemini" : config.openaiKey ? "openai" : config.anthropicKey ? "anthropic" : "mock");

export const AGENT_UID = "pairtick-agent";

// Money is stored as integer micro-dollars (µ$) to avoid float drift.
export const USD = (n) => Math.round(n * 1_000_000);

// Personas. Rates are per second (µ$/s) for chat / voice / video,
// plus a flat per-message fee and a per-1k-token fee for the agent.
export const PEOPLE = [
  { uid: "pt-client-ada", name: "Ada Obi", role: "client", title: "Junior frontend dev" },
  { uid: "pt-client-sam", name: "Sam Reyes", role: "client", title: "Founder, needs a review" },
  {
    uid: "pt-expert-grace",
    name: "Grace Hoppe",
    role: "expert",
    title: "Staff engineer · compilers, TypeScript",
    tags: ["TypeScript", "Node", "Perf"],
    rates: { chat: USD(0.004), voice: USD(0.009), video: USD(0.014), message: USD(0.01) },
  },
  {
    uid: "pt-expert-linus",
    name: "Linus Tor",
    role: "expert",
    title: "Principal · systems, Rust, Linux",
    tags: ["Rust", "Go", "Infra"],
    rates: { chat: USD(0.005), voice: USD(0.011), video: USD(0.016), message: USD(0.01) },
  },
  {
    uid: "pt-expert-ken",
    name: "Ken Thom",
    role: "expert",
    title: "Senior · React, design systems",
    tags: ["React", "CSS", "A11y"],
    rates: { chat: USD(0.003), voice: USD(0.007), video: USD(0.011), message: USD(0.008) },
  },
  {
    uid: AGENT_UID,
    name: "Tick",
    role: "agent",
    title: "AI pair programmer · reads your editor",
    tags: ["AI", "Any stack"],
    rates: { chat: USD(0.0005), voice: 0, video: 0, message: USD(0.002), per1kTokens: USD(0.02) },
  },
];

export const PLATFORM_FEE = 0.2; // 20% platform take, 80% to the expert
export const STARTING_BALANCE = USD(5);
