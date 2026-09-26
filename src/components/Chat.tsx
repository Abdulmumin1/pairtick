import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, money, streamAgent, type Person, type Session } from "../lib/api";
import { history, listen, metaSession, sendText, typing } from "../lib/cometchat";
import { IconSend } from "./icons";

type Msg = { id: string; from: string; text: string; at: number; streaming?: boolean; note?: string };

/** Tiny renderer: fenced code blocks + inline code. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose)
      out.push(
        <Fragment key={i}>
          {prose.split(/(`[^`\n]+`)/g).map((p, j) => (p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={j}>{p.slice(1, -1)}</code> : p))}
        </Fragment>,
      );
    if (parts[i + 2] !== undefined) out.push(<pre key={i + "c"}>{parts[i + 2].replace(/\n$/, "")}</pre>);
  }
  return <>{out}</>;
}

export function Chat({
  me,
  other,
  snap,
  getCode,
  onSnap,
}: {
  me: Person;
  other: Person;
  snap: Session;
  getCode: () => string;
  onSnap: (s: Session) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number>(0);
  const abort = useRef<AbortController | null>(null);
  const isAgent = other.role === "agent";
  const live = snap.status === "live";
  const sid = snap.id;

  // Realtime delivery is best-effort: a message sent while either socket is
  // reconnecting never fires the listener. So we also re-sync from history on
  // mount, on every reconnect, and every few seconds, merging by message id.
  useEffect(() => {
    let alive = true;
    const resync = () =>
      history(other.uid, sid)
        .then((list) => {
          if (!alive) return;
          setMsgs((l) => {
            const have = new Set(l.map((m) => m.id));
            const add = list
              .filter((m) => !have.has(String(m.getId())))
              // our own just-sent message may still carry its local id
              .filter((m) => !l.some((x) => x.id.startsWith("local-") && x.from === m.getSender().getUid() && x.text === m.getText()))
              // an agent reply that is still streaming locally
              .filter((m) => !(m.getSender().getUid() === other.uid && l.some((x) => x.streaming)))
              .map((m) => ({ id: String(m.getId()), from: m.getSender().getUid(), text: m.getText(), at: m.getSentAt() * 1000 }));
            return add.length ? [...l, ...add].sort((a, b) => a.at - b.at) : l;
          });
        })
        .catch(() => {});
    resync();
    const t = setInterval(resync, 4000);
    const off = listen({
      text: (m) => {
        if (metaSession(m) !== sid || m.getSender().getUid() !== other.uid) return;
        const id = String(m.getId());
        setMsgs((l) => (l.some((x) => x.id === id || x.streaming) ? l : [...l, { id, from: other.uid, text: m.getText(), at: m.getSentAt() * 1000 }]));
      },
      typing: (from, on) => from === other.uid && setOtherTyping(on),
      connected: resync,
    });
    return () => {
      alive = false;
      clearInterval(t);
      off();
    };
  }, [sid, other.uid]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs, otherTyping]);

  useEffect(() => () => abort.current?.abort(), []);

  const askAgent = async (prompt: string, prior: Msg[]) => {
    const tmpId = "stream-" + Date.now();
    const before = snap.cost.tokens;
    let tokensBefore = snap.usage.tokens;
    let latest = snap;
    setThinking(true);
    setMsgs((l) => [...l, { id: tmpId, from: other.uid, text: "", at: Date.now(), streaming: true }]);
    abort.current = new AbortController();
    const patch = (fn: (m: Msg) => Msg) => setMsgs((l) => l.map((m) => (m.id === tmpId ? fn(m) : m)));
    await streamAgent(
      sid,
      {
        prompt,
        code: getCode(),
        lang: "javascript",
        history: prior.slice(-8).map((m) => ({ role: m.from === other.uid ? "agent" : "user", text: m.text })),
      },
      {
        meter: (s) => ((latest = s), (tokensBefore = Math.min(tokensBefore, s.usage.tokens)), onSnap(s)),
        delta: (d, s) => {
          latest = s;
          onSnap(s);
          patch((m) => ({ ...m, text: m.text + d, note: `${(s.usage.tokens - tokensBefore).toLocaleString()} tokens · ${money(s.cost.tokens - before, 5)}` }));
        },
        done: (r) => {
          setMsgs((l) => {
            const persisted = r.persisted ? String(r.persisted) : null;
            const rest = persisted ? l.filter((m) => m.id !== persisted) : l;
            return rest.map((m) =>
              m.id === tmpId
                ? { ...m, id: persisted ?? tmpId, text: r.text || m.text, streaming: false, note: `${(latest.usage.tokens - tokensBefore).toLocaleString()} tokens · ${money(latest.cost.tokens - before, 5)}` }
                : m,
            );
          });
        },
        error: (e) => patch((m) => ({ ...m, streaming: false, text: m.text + `\n\n(${e})` })),
      },
      abort.current.signal,
    ).catch(() => {});
    setThinking(false);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !live) return;
    setDraft("");
    typing(other.uid, false);
    const prior = msgs;
    const local: Msg = { id: "local-" + Date.now(), from: me.uid, text, at: Date.now() };
    setMsgs((l) => [...l, local]);
    Promise.resolve()
      .then(() => sendText(other.uid, text, sid))
      .then((sent) => setMsgs((l) => l.map((m) => (m.id === local.id ? { ...m, id: String(sent.getId()) } : m))))
      .catch(() => {});
    api.message(sid).then(onSnap).catch(() => {});
    if (isAgent) askAgent(text, [...prior, local]);
  };

  const onDraft = (v: string) => {
    setDraft(v);
    if (isAgent) return;
    typing(other.uid, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => typing(other.uid, false), 1500);
  };

  const perMsg = money(snap.rates.message, 3);

  return (
    <div className="pane" style={{ flex: 1, minHeight: 0 }}>
      <div className="pane-head">
        <h3>Chat</h3>
        <span className="faint small">{isAgent ? `${money(snap.rates.per1kTokens ?? 0, 3)} / 1k tokens, streamed` : `${perMsg} per message`}</span>
      </div>
      <div className="chat" ref={scroller}>
        {msgs.length === 0 && (
          <div className="system">
            {isAgent ? "Ask Tick anything about the code on the left. It reads the editor on every message." : `Say hi to ${other.name.split(" ")[0]}. The editor on the left is shared live.`}
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.from === me.uid;
          return (
            <div key={m.id} className={`msg ${mine ? "mine" : ""}`}>
              <div className="bubble">
                <Rich text={m.text} />
                {m.streaming && <span className="caret" />}
              </div>
              <div className="msg-meta">
                <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {m.note && <span className="mono">{m.note}</span>}
              </div>
            </div>
          );
        })}
        {otherTyping && <div className="system">{other.name.split(" ")[0]} is typing…</div>}
      </div>
      <div className="composer">
        <textarea
          value={draft}
          placeholder={live ? (isAgent ? "Ask about the code…" : "Message") : snap.status === "pending" ? "Waiting for them to accept…" : "Session ended"}
          disabled={!live}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {thinking ? (
          <button className="btn" onClick={() => abort.current?.abort()} title="Stop generating (stops billing)">
            Stop
          </button>
        ) : (
          <button className="btn primary icon" onClick={send} disabled={!live || !draft.trim()} aria-label="Send">
            <IconSend />
          </button>
        )}
      </div>
    </div>
  );
}
