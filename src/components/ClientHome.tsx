import { useEffect, useState } from "react";
import { api, money, perMinute, hourly, initials, clock, type AppConfig, type Person, type Session } from "../lib/api";
import { listen, presence, sendLifecycle } from "../lib/cometchat";
import { go } from "../App";

export function usePresence(uids: string[]) {
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const key = uids.join(",");
  useEffect(() => {
    presence(uids).then(setOnline).catch(() => {});
    return listen({ presence: (uid, on) => setOnline((o) => ({ ...o, [uid]: on })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return online;
}

export function History({ me, people }: { me: Person; people: Person[] }) {
  const [list, setList] = useState<Session[]>([]);
  useEffect(() => {
    api.sessions(me.uid).then(setList);
  }, [me.uid]);
  const done = list.filter((s) => s.status === "ended" && s.startedAt);
  if (!done.length) return null;
  const name = (uid: string) => people.find((p) => p.uid === uid)?.name ?? uid;
  return (
    <div className="section">
      <h2>Recent sessions</h2>
      <div className="list">
        {done.slice(0, 8).map((s) => (
          <a key={s.id} className="item" href={`#/s/${s.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <div className="grow">
              <div>{name(me.role === "client" ? s.expertUid : s.clientUid)}</div>
              <div className="faint small">
                {new Date(s.createdAt).toLocaleString()} · {clock((s.endedAt ?? s.serverNow) - (s.startedAt ?? s.createdAt))}
                {s.endReason === "insufficient_funds" ? " · wallet ran out" : ""}
              </div>
            </div>
            <span className="mono">{money(me.role === "client" ? s.total : s.expertEarned)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function ClientHome({ me, people, cfg }: { me: Person; people: Person[]; cfg: AppConfig }) {
  const experts = people.filter((p) => p.role !== "client").sort((a) => (a.role === "agent" ? -1 : 1));
  const online = usePresence(experts.map((e) => e.uid));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const start = async (p: Person) => {
    setBusy(p.uid);
    setErr("");
    try {
      const s = await api.create(me.uid, p.uid);
      if (p.role !== "agent") await sendLifecycle(p.uid, "pairtick.invite", s.id);
      go(`/s/${s.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };

  return (
    <main className="page">
      <div className="eyebrow">Find help</div>
      <h1 className="title" style={{ marginTop: 6 }}>
        Who do you want to pair with?
      </h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Billing starts when they accept and stops the instant anyone leaves. Chat is cheapest; voice and video switch the rate only while they're on.
      </p>
      {err && <div className="banner warn" style={{ borderRadius: 6, border: 0 }}>{err}</div>}

      <div className="section">
        <div className="list">
          {experts.map((p) => {
            const isAgent = p.role === "agent";
            const on = isAgent || online[p.uid];
            const r = p.rates!;
            return (
              <div className="item" key={p.uid}>
                <div className={`avatar lg ${isAgent ? "agent" : ""}`}>{isAgent ? "AI" : initials(p.name)}</div>
                <div className="grow">
                  <div className="row">
                    <span className="name">{p.name}</span>
                    <span className={`dot ${on ? "on" : ""}`} title={on ? "online" : "offline"} />
                    <span className="faint small">{isAgent ? `always on · ${cfg.llm === "mock" ? "offline model" : cfg.llm}` : on ? "online" : "offline"}</span>
                  </div>
                  <div className="muted small">{p.title}</div>
                  <div className="tags" style={{ marginTop: 6 }}>
                    {p.tags?.map((t) => (
                      <span className="pill" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rates" title={`chat ${hourly(r.chat)} · voice ${hourly(r.voice)} · video ${hourly(r.video)}`}>
                  <div>
                    <span>chat</span>
                    {perMinute(r.chat)}
                  </div>
                  {isAgent ? (
                    <>
                      <div>
                        <span>1k tokens</span>
                        {money(r.per1kTokens ?? 0, 3)}
                      </div>
                      <div>
                        <span>message</span>
                        {money(r.message, 3)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span>voice</span>
                        {perMinute(r.voice)}
                      </div>
                      <div>
                        <span>video</span>
                        {perMinute(r.video)}
                      </div>
                    </>
                  )}
                </div>
                <button className={`btn ${isAgent || on ? "primary" : ""}`} disabled={busy !== null} onClick={() => start(p)}>
                  {busy === p.uid ? "Starting…" : "Start"}
                </button>
              </div>
            );
          })}
        </div>
        <p className="faint small">Metered to the millisecond; you only pay for time actually spent in each mode. Plus a small per-message fee. 80% goes to the expert.</p>
      </div>
      <History me={me} people={people} />
    </main>
  );
}
