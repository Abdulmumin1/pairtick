export type Rates = { chat: number; voice: number; video: number; message: number; per1kTokens?: number };
export type Person = {
  uid: string;
  name: string;
  role: "client" | "expert" | "agent";
  title: string;
  tags?: string[];
  rates?: Rates;
  balance: number;
};
export type Mode = "chat" | "voice" | "video";
export type Session = {
  id: string;
  clientUid: string;
  expertUid: string;
  kind: "human" | "agent";
  status: "pending" | "live" | "ended";
  endReason: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  lastTickAt: number | null;
  mode: Mode;
  rates: Rates;
  usage: { chatMs: number; voiceMs: number; videoMs: number; messages: number; tokens: number; frames: number };
  cost: { chat: number; voice: number; video: number; messages: number; tokens: number };
  total: number;
  ticks: number;
  serverNow: number;
  clientBalance: number;
  expertBalance: number;
  expertEarned: number;
  currentRate: number;
};
export type AppConfig = {
  appId: string;
  region: string;
  authKey: string;
  configured: boolean;
  rest: boolean;
  llm: string;
  agentUid: string;
  platformFee: number;
};

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export const api = {
  config: () => req<AppConfig>("/config"),
  people: () => req<Person[]>("/people"),
  wallet: (uid: string) => req<{ balance: number }>(`/wallet/${uid}`),
  topup: (uid: string, amount: number) => req<{ balance: number }>(`/wallet/${uid}/topup`, { amount }),
  setBalance: (uid: string, amount: number) => req<{ balance: number }>(`/wallet/${uid}/set`, { amount }),
  create: (clientUid: string, expertUid: string) => req<Session>("/sessions", { clientUid, expertUid }),
  sessions: (uid: string, status?: string) => req<Session[]>(`/sessions?uid=${uid}${status ? `&status=${status}` : ""}`),
  session: (id: string) => req<Session>(`/sessions/${id}`),
  accept: (id: string) => req<Session>(`/sessions/${id}/accept`, {}),
  decline: (id: string) => req<Session>(`/sessions/${id}/decline`, {}),
  end: (id: string, reason?: string) => req<Session>(`/sessions/${id}/end`, { reason }),
  tick: (id: string, mode: Mode, frames: number) => req<Session>(`/sessions/${id}/tick`, { mode, frames }),
  message: (id: string) => req<Session>(`/sessions/${id}/message`, {}),
};

/** Streams an agent reply. Each chunk is billed server-side as it arrives. */
export async function streamAgent(
  id: string,
  body: { prompt: string; code: string; lang: string; history: { role: string; text: string }[] },
  on: { delta: (d: string, s: Session) => void; meter: (s: Session) => void; done: (r: { text: string; cutoff: boolean; persisted: number | null }) => void; error: (m: string) => void },
  signal?: AbortSignal,
) {
  const res = await fetch(`/api/sessions/${id}/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) return on.error("no stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: (.*)$/m)?.[1];
      const data = chunk.match(/^data: (.*)$/m)?.[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (ev === "delta") on.delta(d.delta, d.snap);
      else if (ev === "meter") on.meter(d);
      else if (ev === "done") on.done(d);
      else if (ev === "error") on.error(d.message);
    }
  }
}

// ---- formatting ----
/** µ$ → "$0.0421" */
export const money = (micro: number, digits = 4) => "$" + (micro / 1_000_000).toFixed(digits);
/** µ$/s → "$0.014/s" */
export const rate = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 1000 ? 4 : 3)}/s`;
/** µ$/s → "$0.84/min" */
export const perMinute = (micro: number) => `$${((micro * 60) / 1_000_000).toFixed(2)}/min`;
/** µ$/s → "$50.40/h" */
export const hourly = (micro: number) => `$${((micro * 3600) / 1_000_000).toFixed(2)}/h`;
export const clock = (ms: number, tenths = true) => {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${h ? h + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tenths ? "." + d : ""}`;
};
export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
