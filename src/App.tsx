import { useEffect, useState } from "react";
import { api, type AppConfig, type Person } from "./lib/api";
import { connect, disconnect, listen, sendLifecycle } from "./lib/cometchat";
import { ClientHome } from "./components/ClientHome";
import { ExpertHome } from "./components/ExpertHome";
import { Room } from "./components/Room";
import { Topbar, Setup, SignIn } from "./components/Topbar";

type Invite = { sessionId: string; from: string };

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
};
export const go = (path: string) => (location.hash = path);

export default function App() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<Person | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const hash = useHash();

  useEffect(() => {
    Promise.all([api.config(), api.people()])
      .then(([c, p]) => {
        setCfg(c);
        setPeople(p);
        const saved = localStorage.getItem("pt.me");
        const found = p.find((x) => x.uid === saved);
        if (found && c.configured) setMe(found);
      })
      .catch(() => setError("Can't reach the pairtick server. Is `npm run dev` running?"));
  }, []);

  useEffect(() => {
    if (!cfg || !me) return;
    setStatus("connecting");
    connect(cfg, me, people)
      .then(() => setStatus("ready"))
      .catch((e) => {
        setStatus("error");
        setError(e?.message || String(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, me]);

  // Experts get invites from anywhere in the app.
  useEffect(() => {
    if (status !== "ready" || me?.role !== "expert") return;
    // Realtime invites are instant; this poll catches any the socket missed.
    const poll = () =>
      api
        .sessions(me.uid, "pending")
        .then((list) =>
          setInvites((l) => {
            const pending = new Set(list.map((s) => s.id));
            const kept = l.filter((i) => pending.has(i.sessionId));
            const added = list.filter((s) => !kept.some((i) => i.sessionId === s.id)).map((s) => ({ sessionId: s.id, from: s.clientUid }));
            return added.length || kept.length !== l.length ? [...kept, ...added] : l;
          }),
        )
        .catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    const off = listen({
      custom: (type, data, from) => {
        if (type === "pairtick.invite") setInvites((l) => (l.some((i) => i.sessionId === data.sessionId) ? l : [...l, { sessionId: data.sessionId, from }]));
        if (type === "pairtick.end") setInvites((l) => l.filter((i) => i.sessionId !== data.sessionId));
      },
    });
    return () => (clearInterval(t), off());
  }, [status, me]);

  const signOut = async () => {
    localStorage.removeItem("pt.me");
    await disconnect();
    setMe(null);
    setStatus("idle");
    go("/");
  };

  const accept = async (inv: Invite) => {
    setInvites((l) => l.filter((i) => i.sessionId !== inv.sessionId));
    await api.accept(inv.sessionId);
    sendLifecycle(inv.from, "pairtick.accept", inv.sessionId);
    go(`/s/${inv.sessionId}`);
  };
  const decline = async (inv: Invite) => {
    setInvites((l) => l.filter((i) => i.sessionId !== inv.sessionId));
    await api.decline(inv.sessionId);
    sendLifecycle(inv.from, "pairtick.decline", inv.sessionId);
  };

  if (error && status !== "ready")
    return (
      <div className="center">
        <div className="card pad" style={{ maxWidth: 480 }}>
          <h3>Something's off</h3>
          <p className="muted">{error}</p>
          <button className="btn" onClick={() => location.reload()}>
            Retry
          </button>
          {me && (
            <button className="btn ghost" onClick={signOut} style={{ marginLeft: 8 }}>
              Switch user
            </button>
          )}
        </div>
      </div>
    );
  if (!cfg) return <div className="center muted">Loading…</div>;
  if (!cfg.configured) return <Setup />;
  if (!me)
    return (
      <SignIn
        people={people}
        onPick={(p) => {
          localStorage.setItem("pt.me", p.uid);
          setMe(p);
        }}
      />
    );
  if (status !== "ready") return <div className="center muted">Connecting to CometChat…</div>;

  const room = hash.match(/^#\/s\/([\w-]+)/)?.[1];
  const byUid = (uid: string) => people.find((p) => p.uid === uid);

  return (
    <>
      {room ? (
        <Room key={room} id={room} me={me} people={people} cfg={cfg} />
      ) : (
        <>
          <Topbar me={me} onSignOut={signOut} />
          {me.role === "client" ? <ClientHome me={me} people={people} cfg={cfg} /> : <ExpertHome me={me} people={people} onAccept={accept} onDecline={decline} />}
        </>
      )}
      {!room && invites.length > 0 && (
        <div className="toasts">
          {invites.map((inv) => (
            <div className="toast" key={inv.sessionId}>
              <div className="row">
                <span className="dot live" />
                <strong>{byUid(inv.from)?.name ?? inv.from}</strong>
                <span className="muted">wants a session</span>
              </div>
              <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => decline(inv)}>
                  Decline
                </button>
                <button className="btn primary" onClick={() => accept(inv)}>
                  Accept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
