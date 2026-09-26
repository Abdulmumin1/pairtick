import { useEffect, useRef, useState } from "react";
import { money, rate, perMinute, clock, initials, type Person, type Session } from "../lib/api";

/** Ticks once a second — enough for a mm:ss clock, not enough to be twitchy. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** How often the money on screen refreshes. Billing itself still happens every 200ms server-side. */
export const DISPLAY_EVERY_MS = 5000;

/**
 * Holds the latest snapshot but only lets the UI see it every few seconds —
 * except for changes the user caused (mode/status), which show immediately.
 */
function useSettled(snap: Session) {
  const latest = useRef(snap);
  latest.current = snap;
  const [settled, setSettled] = useState(snap);
  useEffect(() => {
    const t = setInterval(() => setSettled(latest.current), DISPLAY_EVERY_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setSettled(latest.current);
  }, [snap.status, snap.mode, snap.usage.messages]);
  return settled;
}

function Spark({ samples }: { samples: { t: number; r: number }[] }) {
  const W = 180;
  const H = 28;
  if (samples.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} />;
  const t1 = samples[samples.length - 1].t;
  const t0 = t1 - 60_000;
  const max = Math.max(...samples.map((s) => s.r), 1);
  const x = (t: number) => ((t - t0) / 60_000) * W;
  const y = (r: number) => H - 2 - (r / max) * (H - 4);
  let d = "";
  samples.forEach((s, i) => {
    const px = Math.max(0, x(s.t));
    d += i === 0 ? `M${px},${y(s.r)}` : `H${px}V${y(s.r)}`;
  });
  d += `H${W}`;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-label="spend rate, last 60 seconds">
      <line x1="0" x2={W} y1={H - 1} y2={H - 1} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--olive)" strokeWidth="1.5" />
    </svg>
  );
}

export function Meter({
  snap,
  receivedAt,
  me,
  other,
  samples,
  onEnd,
}: {
  snap: Session;
  receivedAt: number;
  me: Person;
  other: Person;
  samples: { t: number; r: number }[];
  onEnd: () => void;
}) {
  const live = snap.status === "live";
  const now = useNow(live);
  const shown = useSettled(snap);
  const payer = me.uid === snap.clientUid;
  const skew = snap.serverNow - receivedAt;
  const elapsed = snap.startedAt ? (snap.endedAt ?? now + skew) - snap.startedAt : 0;
  const amount = payer ? shown.total : shown.expertEarned;
  const secondsLeft = snap.currentRate > 0 ? snap.clientBalance / snap.currentRate : Infinity;
  const isAgent = other.role === "agent";

  return (
    <div className="meter">
      <div className="meter-side">
        <a href="#/" className="btn ghost icon" title="Back" aria-label="Back">
          ←
        </a>
        <div className={`avatar ${isAgent ? "agent" : ""}`}>{isAgent ? "AI" : initials(other.name)}</div>
        <div className="kv">
          <span style={{ fontWeight: 600 }}>{other.name}</span>
          <span className="small muted row" style={{ gap: 6 }}>
            <span className={`dot ${live ? "live" : ""}`} />
            {snap.status === "pending" ? "waiting to accept" : live ? "live" : "ended"}
          </span>
        </div>
      </div>

      <div className="meter-main">
        <div className="meter-total" key={amount} aria-live="off">
          {money(amount, 2)}
        </div>
        <div className="meter-sub">
          <span className="mono">{clock(elapsed, false)}</span>
          <span>·</span>
          <span className={`pill ${live ? "olive" : ""}`}>{isAgent ? "chat + tokens" : snap.mode}</span>
          <span className="mono">{perMinute(live ? snap.currentRate : 0)}</span>
          {payer && live && secondsLeft < 60 && <span className="pill warn">~{Math.max(0, Math.floor(secondsLeft))}s left</span>}
        </div>
      </div>

      <div className="meter-side right">
        <Spark samples={samples} />
        <div className="kv" style={{ textAlign: "right", minWidth: 84 }}>
          <span className="k">{payer ? "Balance" : "Wallet"}</span>
          <span className="v">{money(payer ? Math.max(0, shown.clientBalance) : shown.expertBalance, 2)}</span>
        </div>
        {snap.status !== "ended" && (
          <button className="btn danger" onClick={onEnd}>
            {snap.status === "pending" ? "Cancel" : "End"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Receipt({ snap, me, other, onClose }: { snap: Session; me: Person; other: Person; onClose: () => void }) {
  const payer = me.uid === snap.clientUid;
  const u = snap.usage;
  const c = snap.cost;
  const rows: [string, string, number][] = [];
  if (u.chatMs) rows.push(["Chat", `${clock(u.chatMs)} × ${rate(snap.rates.chat)}`, c.chat]);
  if (u.voiceMs) rows.push(["Voice", `${clock(u.voiceMs)} × ${rate(snap.rates.voice)}`, c.voice]);
  if (u.videoMs) rows.push(["Video", `${clock(u.videoMs)} × ${rate(snap.rates.video)}${u.frames ? ` · ${u.frames.toLocaleString()} frames` : ""}`, c.video]);
  if (u.messages) rows.push(["Messages", `${u.messages} × ${money(snap.rates.message, 3)}`, c.messages]);
  if (u.tokens) rows.push(["Tokens", `${u.tokens.toLocaleString()} × ${money(snap.rates.per1kTokens ?? 0, 3)}/1k`, c.tokens]);
  const reason =
    snap.endReason === "insufficient_funds"
      ? "Stopped automatically — wallet ran out."
      : snap.endReason === "declined"
        ? `${other.name} declined or the request was cancelled.`
        : null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="receipt" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Receipt · {snap.id}</div>
        <h2 style={{ marginTop: 6 }}>Session with {other.name}</h2>
        {reason && <p className="muted small">{reason}</p>}
        <table style={{ marginTop: 16 }}>
          <tbody>
            {rows.map(([k, d, v]) => (
              <tr key={k}>
                <td>
                  {k}
                  <div className="faint small mono">{d}</div>
                </td>
                <td>{money(v, 4)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="faint">Nothing billed</td>
                <td>{money(0, 4)}</td>
              </tr>
            )}
            <tr className="total">
              <td>{payer ? "Total charged" : "You earned"}</td>
              <td>{money(payer ? snap.total : snap.expertEarned, 4)}</td>
            </tr>
          </tbody>
        </table>
        <p className="faint small">
          {snap.ticks.toLocaleString()} metering ticks · {payer ? `balance ${money(snap.clientBalance, 2)}` : `platform fee ${money(snap.total - snap.expertEarned, 4)}`}
        </p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn" onClick={onClose}>
            View session
          </button>
          <a className="btn primary" href="#/">
            Done
          </a>
        </div>
      </div>
    </div>
  );
}

export function useSamples(snap: Session | null) {
  const ref = useRef<{ t: number; r: number }[]>([]);
  if (snap) {
    const arr = ref.current;
    const last = arr[arr.length - 1];
    if (!last || snap.serverNow > last.t) {
      arr.push({ t: snap.serverNow, r: snap.currentRate });
      while (arr.length && arr[0].t < snap.serverNow - 60_000) arr.shift();
    }
  }
  return ref.current;
}
