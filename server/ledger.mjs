import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PEOPLE, PLATFORM_FEE, STARTING_BALANCE, AGENT_UID } from "./config.mjs";

// Point PAIRTICK_DATA_DIR at a mounted volume in production so wallets survive redeploys.
const DATA_DIR = resolve(process.env.PAIRTICK_DATA_DIR || resolve(process.cwd(), "data"));
const DATA_FILE = resolve(DATA_DIR, "ledger.json");

// Max gap we'll bill between two ticks. If a tab sleeps or the network
// drops, the payer isn't charged for the dead air.
const MAX_TICK_GAP_MS = 1500;

const state = load();

function load() {
  if (existsSync(DATA_FILE)) {
    try {
      return JSON.parse(readFileSync(DATA_FILE, "utf8"));
    } catch {}
  }
  const wallets = {};
  for (const p of PEOPLE) wallets[p.uid] = p.role === "client" ? STARTING_BALANCE : 0;
  return { wallets, sessions: {}, platform: 0 };
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  }, 500);
}

// ---- subscribers (SSE) ----
const subs = new Map(); // sessionId -> Set<fn>
export function subscribe(id, fn) {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id).add(fn);
  return () => subs.get(id)?.delete(fn);
}
function emit(s) {
  const snap = snapshot(s);
  subs.get(s.id)?.forEach((fn) => fn(snap));
}

export const person = (uid) => PEOPLE.find((p) => p.uid === uid);

export function balance(uid) {
  if (!(uid in state.wallets)) state.wallets[uid] = person(uid)?.role === "client" ? STARTING_BALANCE : 0;
  return state.wallets[uid];
}

export function topup(uid, amount) {
  balance(uid);
  state.wallets[uid] += Math.max(0, Math.min(amount, 100_000_000));
  save();
  return state.wallets[uid];
}

/** Demo helper: set a wallet to an exact amount (e.g. $0.20 to film the auto-cutoff). */
export function setBalance(uid, amount) {
  balance(uid);
  state.wallets[uid] = Math.max(0, Math.min(Math.round(amount), 100_000_000));
  save();
  return state.wallets[uid];
}

export function createSession({ clientUid, expertUid }) {
  const expert = person(expertUid);
  if (!expert || expert.role === "client") throw new Error("unknown expert");
  if (balance(clientUid) <= 0) throw new Error("insufficient funds");
  const isAgent = expertUid === AGENT_UID;
  const now = Date.now();
  const s = {
    id: "pt_" + randomUUID().slice(0, 8),
    clientUid,
    expertUid,
    kind: isAgent ? "agent" : "human",
    status: isAgent ? "live" : "pending",
    endReason: null,
    createdAt: now,
    startedAt: isAgent ? now : null,
    endedAt: null,
    lastTickAt: isAgent ? now : null,
    mode: "chat",
    rates: expert.rates,
    usage: { chatMs: 0, voiceMs: 0, videoMs: 0, messages: 0, tokens: 0, frames: 0 },
    cost: { chat: 0, voice: 0, video: 0, messages: 0, tokens: 0 },
    total: 0,
    ticks: 0,
  };
  state.sessions[s.id] = s;
  save();
  return snapshot(s);
}

export function getSession(id) {
  const s = state.sessions[id];
  return s ? snapshot(s) : null;
}

export function listSessions({ uid, status }) {
  return Object.values(state.sessions)
    .filter((s) => !uid || s.clientUid === uid || s.expertUid === uid)
    .filter((s) => !status || s.status === status)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(snapshot);
}

export function accept(id) {
  const s = must(id);
  if (s.status !== "pending") return snapshot(s);
  const now = Date.now();
  s.status = "live";
  s.startedAt = now;
  s.lastTickAt = now;
  save();
  emit(s);
  return snapshot(s);
}

export function end(id, reason = "ended") {
  const s = must(id);
  if (s.status === "ended") return snapshot(s);
  s.status = "ended";
  s.endReason = reason;
  s.endedAt = Date.now();
  save();
  emit(s);
  return snapshot(s);
}

/**
 * Core metering. Charges the payer for the wall-clock time since the last
 * tick at the rate for the mode they're currently in. Called ~5x per second.
 */
export function tick(id, { mode, frames = 0 }) {
  const s = must(id);
  if (s.status !== "live") return snapshot(s);
  const now = Date.now();
  const dt = Math.min(now - s.lastTickAt, MAX_TICK_GAP_MS);
  s.lastTickAt = now;
  const m = s.kind === "agent" ? "chat" : ["chat", "voice", "video"].includes(mode) ? mode : "chat";
  s.mode = m;
  s.ticks++;
  s.usage[m + "Ms"] += dt;
  s.usage.frames += Math.max(0, Math.min(Number(frames) || 0, 240));
  charge(s, Math.round((s.rates[m] * dt) / 1000), m);
  emit(s);
  return snapshot(s);
}

export function chargeMessage(id) {
  const s = must(id);
  if (s.status !== "live") return snapshot(s);
  s.usage.messages++;
  charge(s, s.rates.message, "messages");
  emit(s);
  return snapshot(s);
}

export function chargeTokens(id, tokens) {
  const s = must(id);
  if (s.status !== "live") return { ok: false, snap: snapshot(s) };
  s.usage.tokens += tokens;
  charge(s, Math.round(((s.rates.per1kTokens || 0) * tokens) / 1000), "tokens");
  emit(s);
  return { ok: s.status === "live", snap: snapshot(s) };
}

function charge(s, amount, bucket) {
  if (amount <= 0) return;
  const bal = balance(s.clientUid);
  const take = Math.min(amount, bal);
  state.wallets[s.clientUid] = bal - take;
  const fee = Math.round(take * PLATFORM_FEE);
  state.wallets[s.expertUid] = balance(s.expertUid) + (take - fee);
  state.platform += fee;
  s.cost[bucket] += take;
  s.total += take;
  if (state.wallets[s.clientUid] <= 0) {
    s.status = "ended";
    s.endReason = "insufficient_funds";
    s.endedAt = Date.now();
  }
  save();
}

function must(id) {
  const s = state.sessions[id];
  if (!s) throw Object.assign(new Error("session not found"), { status: 404 });
  return s;
}

function snapshot(s) {
  return {
    ...s,
    serverNow: Date.now(),
    clientBalance: balance(s.clientUid),
    expertBalance: balance(s.expertUid),
    expertEarned: s.total - Math.round(s.total * PLATFORM_FEE),
    currentRate: s.status === "live" ? s.rates[s.mode] : 0,
  };
}
