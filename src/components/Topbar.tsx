import { useEffect, useState } from "react";
import { api, money, initials, type Person } from "../lib/api";
import { go } from "../App";

export function Brand() {
  return (
    <a className="brand" href="#/" style={{ color: "inherit", textDecoration: "none" }}>
      <span className="brand-mark" />
      pairtick
    </a>
  );
}

export function Topbar({ me, onSignOut }: { me: Person; onSignOut: () => void }) {
  const [bal, setBal] = useState(me.balance);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => api.wallet(me.uid).then((w) => setBal(w.balance));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [me.uid]);

  return (
    <header className="topbar">
      <Brand />
      <span className="grow" />
      <div className="kv" style={{ textAlign: "right" }}>
        <span className="k">{me.role === "client" ? "Balance" : "Earned"}</span>
        <span className="v">{money(bal, 2)}</span>
      </div>
      {me.role === "client" && (
        <div className="popover-anchor">
          <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Test-mode wallet">
            Test funds
          </button>
          {open && (
            <div className="popover" role="menu">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Set test balance
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {[0.2, 1, 5, 20].map((usd) => (
                  <button
                    key={usd}
                    className="btn"
                    onClick={() =>
                      api.setBalance(me.uid, usd * 1_000_000).then((w) => {
                        setBal(w.balance);
                        setOpen(false);
                      })
                    }
                  >
                    ${usd < 1 ? usd.toFixed(2) : usd}
                  </button>
                ))}
              </div>
              <p className="faint small" style={{ margin: "10px 0 0" }}>
                Try $0.20 and start a video call: the session ends itself at $0.00.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="row" style={{ paddingLeft: 8, borderLeft: "1px solid var(--line)" }}>
        <div className="avatar">{initials(me.name)}</div>
        <button className="btn ghost small" onClick={onSignOut}>
          Switch
        </button>
      </div>
    </header>
  );
}

export function Setup() {
  return (
    <div className="center">
      <div className="signin stack">
        <Brand />
        <h1 className="title">Connect CometChat</h1>
        <p className="muted" style={{ margin: 0 }}>
          pairtick needs a CometChat App ID, Region and Auth Key. The free tier is enough.
        </p>
        <div className="card pad">
          <ol className="steps">
            <li>
              Provision credentials into this folder:
              <pre className="block">npx @cometchat/skills-cli@3 auth login{"\n"}npx @cometchat/skills-cli@3 provision run</pre>
            </li>
            <li>
              or copy <code className="inline">.env.example</code> to <code className="inline">.env</code> and fill it in.
            </li>
            <li>Restart <code className="inline">npm run dev</code>, then reload.</li>
          </ol>
        </div>
        <button className="btn primary lg" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

export function SignIn({ people, onPick }: { people: Person[]; onPick: (p: Person) => void }) {
  const clients = people.filter((p) => p.role === "client");
  const experts = people.filter((p) => p.role === "expert");
  const Row = (p: Person) => (
    <button key={p.uid} className="persona" onClick={() => (go("/"), onPick(p))}>
      <div className="avatar">{initials(p.name)}</div>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div className="muted small">{p.title}</div>
      </div>
      <span className="faint">→</span>
    </button>
  );
  return (
    <div className="center">
      <div className="signin stack" style={{ gap: 20 }}>
        <Brand />
        <div>
          <h1 className="title">Senior help, billed by the second.</h1>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Open a shared editor with an expert or an AI pair. Chat, voice and video are metered live — you pay for exactly what streams, and nothing when it stops.
          </p>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            I need help
          </div>
          <div className="list">{clients.map(Row)}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            I'm an expert
          </div>
          <div className="list">{experts.map(Row)}</div>
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          Demo personas. Open a private window (or another browser) as an expert to take the call.
        </p>
      </div>
    </div>
  );
}
