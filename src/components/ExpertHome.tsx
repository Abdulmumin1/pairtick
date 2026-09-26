import { useEffect, useState } from "react";
import { api, perMinute as rate, initials, type Person, type Session } from "../lib/api";
import { listen } from "../lib/cometchat";
import { History } from "./ClientHome";
import { go } from "../App";

type Invite = { sessionId: string; from: string };

export function ExpertHome({
  me,
  people,
  onAccept,
  onDecline,
}: {
  me: Person;
  people: Person[];
  onAccept: (i: Invite) => void;
  onDecline: (i: Invite) => void;
}) {
  const [pending, setPending] = useState<Session[]>([]);
  const [live, setLive] = useState<Session[]>([]);

  useEffect(() => {
    const load = () => {
      api.sessions(me.uid, "pending").then(setPending);
      api.sessions(me.uid, "live").then(setLive);
    };
    load();
    const t = setInterval(load, 2000);
    const off = listen({ custom: () => load() });
    return () => (clearInterval(t), off());
  }, [me.uid]);

  const name = (uid: string) => people.find((p) => p.uid === uid)?.name ?? uid;
  const r = me.rates!;

  return (
    <main className="page">
      <div className="eyebrow">Expert console</div>
      <h1 className="title" style={{ marginTop: 6 }}>
        You're online, {me.name.split(" ")[0]}.
      </h1>
      <p className="muted">
        Your rate card: chat {rate(r.chat)} · voice {rate(r.voice)} · video {rate(r.video)}. You keep 80%, credited every tick.
      </p>

      {live.length > 0 && (
        <div className="section">
          <h2>In progress</h2>
          <div className="list">
            {live.map((s) => (
              <div className="item" key={s.id}>
                <span className="dot live" />
                <div className="grow">{name(s.clientUid)}</div>
                <button className="btn primary" onClick={() => go(`/s/${s.id}`)}>
                  Rejoin
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Requests</h2>
        <div className="list">
          {pending.length === 0 && <div className="empty">No requests yet. They'll appear here and as a notification.</div>}
          {pending.map((s) => (
            <div className="item" key={s.id}>
              <div className="avatar">{initials(name(s.clientUid))}</div>
              <div className="grow">
                <div className="name">{name(s.clientUid)}</div>
                <div className="faint small">requested {new Date(s.createdAt).toLocaleTimeString()}</div>
              </div>
              <button className="btn ghost" onClick={() => onDecline({ sessionId: s.id, from: s.clientUid })}>
                Decline
              </button>
              <button className="btn primary" onClick={() => onAccept({ sessionId: s.id, from: s.clientUid })}>
                Accept
              </button>
            </div>
          ))}
        </div>
      </div>
      <History me={me} people={people} />
    </main>
  );
}
