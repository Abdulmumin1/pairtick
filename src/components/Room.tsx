import { useCallback, useEffect, useRef, useState } from "react";
import { api, perMinute, type AppConfig, type Mode, type Person, type Session } from "../lib/api";
import { listen, sendLifecycle, sendSignal, type RunLine } from "../lib/cometchat";
import { runCode } from "../lib/runner";
import type { frameCounter } from "../lib/frames";
import { Meter, Receipt, useSamples } from "./Meter";
import { Editor } from "./Editor";
import { Chat } from "./Chat";
import { Call, initialCall, type CallState } from "./Call";
import { IconLeave, IconMic, IconMicOff, IconPhone, IconScreen, IconVideo, IconVideoOff } from "./icons";
import { CometChatCalls } from "../lib/cometchat";

const STARTER = `// Shared playground — both of you see every keystroke.
// Hit Run (⌘↵) and the output is shared too.

function average(nums) {
  var total = 0;
  for (let i = 0; i <= nums.length; i++) {
    total += nums[i];
  }
  return total / nums.length;
}

const scores = [92, 78, 85];
console.log("average:", average(scores));

if (average(scores) == "85") console.log("looks right?");
`;

const TICK_MS = 200;

export function Room({ id, me, people }: { id: string; me: Person; people: Person[]; cfg: AppConfig }) {
  const [snap, setSnap] = useState<Session | null>(null);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [notFound, setNotFound] = useState(false);
  const [code, setCode] = useState(() => localStorage.getItem(`pt.code.${id}`) ?? STARTER);
  const [output, setOutput] = useState<RunLine[]>([]);
  const [running, setRunning] = useState(false);
  const [remoteEdit, setRemoteEdit] = useState<string | null>(null);
  const [callKind, setCallKind] = useState<"voice" | "video" | null>(null);
  const [call, setCall] = useState<CallState>(initialCall);
  const [showReceipt, setShowReceipt] = useState(false);
  const frames = useRef<ReturnType<typeof frameCounter> | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  const applySnap = useCallback((s: Session) => {
    setSnap((prev) => (prev && prev.serverNow > s.serverNow ? prev : s));
    setReceivedAt(Date.now());
  }, []);

  // Live ledger snapshots pushed from the server (SSE).
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${id}/stream`);
    es.addEventListener("snap", (e) => applySnap(JSON.parse((e as MessageEvent).data)));
    es.onerror = () => api.session(id).then(applySnap).catch(() => setNotFound(true));
    return () => es.close();
  }, [id, applySnap]);

  const other = snap ? people.find((p) => p.uid === (me.uid === snap.clientUid ? snap.expertUid : snap.clientUid)) : undefined;
  const payer = snap ? me.uid === snap.clientUid : false;
  const live = snap?.status === "live";
  const ended = snap?.status === "ended";
  const isAgent = other?.role === "agent";

  // What's actually streaming right now decides the rate.
  const mode: Mode =
    callKind && call.joined && call.participants >= 2 ? (callKind === "video" && !call.videoPaused ? "video" : "voice") : "chat";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Sub-second metering: the payer's client ticks the ledger 5x/second.
  useEffect(() => {
    if (!payer || !live) return;
    let inflight = false;
    const t = setInterval(() => {
      if (inflight) return;
      inflight = true;
      api
        .tick(id, modeRef.current, frames.current?.take() ?? 0)
        .then(applySnap)
        .catch(() => {})
        .finally(() => (inflight = false));
    }, TICK_MS);
    return () => clearInterval(t);
  }, [payer, live, id, applySnap]);

  // Realtime collaboration over CometChat transient messages.
  useEffect(() => {
    if (!other) return;
    let clear = 0;
    const off = listen({
      signal: (s, from) => {
        if (from !== other.uid || s.sessionId !== id) return;
        if (s.pt === "code") {
          setCode(s.code);
          setRemoteEdit(other.name.split(" ")[0]);
          clearTimeout(clear);
          clear = window.setTimeout(() => setRemoteEdit(null), 1200);
        }
        if (s.pt === "run") setOutput(s.output);
        if (s.pt === "call" && s.action === "start") setCallKind((k) => k ?? s.kind);
      },
      custom: (type, data) => {
        if (data.sessionId === id && (type === "pairtick.accept" || type === "pairtick.end" || type === "pairtick.decline")) api.session(id).then(applySnap);
      },
    });
    return () => (off(), clearTimeout(clear));
  }, [other, id, applySnap]);

  // On join, push our buffer so a late joiner gets the current code.
  useEffect(() => {
    if (live && other && !isAgent) sendSignal(other.uid, { pt: "code", sessionId: id, code: codeRef.current, lang: "javascript" });
  }, [live, other, isAgent, id]);

  useEffect(() => {
    localStorage.setItem(`pt.code.${id}`, code);
  }, [id, code]);

  // Session over → hang up and show the receipt.
  useEffect(() => {
    if (ended) {
      setCallKind(null);
      setShowReceipt(true);
    }
  }, [ended]);

  // The call dropped on its own (idle timeout, network) → back to chat rate.
  const wasJoined = useRef(false);
  useEffect(() => {
    if (wasJoined.current && !call.joined) setCallKind(null);
    wasJoined.current = call.joined;
  }, [call.joined]);

  const sendTimer = useRef(0);
  const edit = (next: string) => {
    setCode(next);
    if (!other || isAgent) return;
    clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => sendSignal(other.uid, { pt: "code", sessionId: id, code: next, lang: "javascript" }), 40);
  };

  const run = async () => {
    setRunning(true);
    const started = performance.now();
    const out = await runCode(code);
    out.push({ kind: "info", text: `done in ${Math.round(performance.now() - started)}ms` });
    setOutput(out);
    setRunning(false);
    if (other && !isAgent) sendSignal(other.uid, { pt: "run", sessionId: id, output: out });
  };

  const startCall = (kind: "voice" | "video") => {
    if (!other) return;
    setCall(initialCall);
    setCallKind(kind);
    sendSignal(other.uid, { pt: "call", sessionId: id, action: "start", kind });
  };

  const endSession = async () => {
    if (!snap || !other) return;
    const s = await api.end(id, snap.status === "pending" ? "declined" : "ended");
    applySnap(s);
    sendLifecycle(other.uid, "pairtick.end", id).catch(() => {});
  };

  const samples = useSamples(snap);

  if (notFound) return <div className="center muted">Session not found. <a href="#/">Go home</a></div>;
  if (!snap || !other) return <div className="center muted">Opening session…</div>;

  return (
    <div className="room">
      <Meter snap={snap} receivedAt={receivedAt} me={me} other={other} samples={samples} onEnd={endSession} />
      <div className="room-body">
        <div className="pane" style={{ minHeight: 0 }}>
          {snap.status === "pending" && (
            <div className="banner olive">
              <span className="dot live" />
              {payer ? `Waiting for ${other.name} to accept. You're not being charged yet.` : "Pending"}
            </div>
          )}
          {payer && live && snap.clientBalance < 500_000 && (
            <div className="banner warn">
              Low balance. The session stops automatically at $0.00.
              <button className="btn" style={{ marginLeft: "auto" }} onClick={() => api.topup(me.uid, 5_000_000).then(() => api.session(id).then(applySnap))}>
                + $5
              </button>
            </div>
          )}
          <Editor code={code} onChange={edit} onRun={run} running={running} output={output} remoteEdit={remoteEdit} disabled={ended} />
        </div>

        <div className="pane" style={{ minHeight: 0 }}>
          {!isAgent && (
            <>
              {callKind && (
                <div className="call">
                  <Call sessionId={id} kind={callKind} onState={setCall} frames={frames} />
                  {!call.joined && <div className="call-overlay">{call.error ?? "Connecting…"}</div>}
                  {call.joined && call.participants < 2 && <div className="call-overlay">Waiting for {other.name.split(" ")[0]} to join · billed at chat rate</div>}
                </div>
              )}
              <div className="call-bar">
                {!callKind ? (
                  <>
                    <button className="btn" disabled={!live} onClick={() => startCall("voice")}>
                      <IconPhone /> Voice <span className="faint mono small">{perMinute(snap.rates.voice)}</span>
                    </button>
                    <button className="btn" disabled={!live} onClick={() => startCall("video")}>
                      <IconVideo /> Video <span className="faint mono small">{perMinute(snap.rates.video)}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button className={`btn icon ${call.audioMuted ? "on" : ""}`} onClick={() => CometChatCalls.toggleAudio()} title={call.audioMuted ? "Unmute" : "Mute"}>
                      {call.audioMuted ? <IconMicOff /> : <IconMic />}
                    </button>
                    {callKind === "video" && (
                      <button className={`btn icon ${call.videoPaused ? "on" : ""}`} onClick={() => CometChatCalls.toggleVideo()} title={call.videoPaused ? "Camera on (video rate)" : "Camera off (voice rate)"}>
                        {call.videoPaused ? <IconVideoOff /> : <IconVideo />}
                      </button>
                    )}
                    <button
                      className={`btn icon ${call.sharing ? "on" : ""}`}
                      onClick={() => (call.sharing ? CometChatCalls.stopScreenSharing() : CometChatCalls.startScreenSharing())}
                      title="Share screen"
                    >
                      <IconScreen />
                    </button>
                    <span className="grow" />
                    <span className="faint small mono" style={{ alignSelf: "center" }}>
                      {mode} · {frames.current ? `${frames.current.total.toLocaleString()} frames` : ""}
                    </span>
                    <button className="btn danger" onClick={() => setCallKind(null)}>
                      <IconLeave /> Leave
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <Chat me={me} other={other} snap={snap} getCode={() => codeRef.current} onSnap={applySnap} />
        </div>
      </div>
      {showReceipt && ended && <Receipt snap={snap} me={me} other={other} onClose={() => setShowReceipt(false)} />}
    </div>
  );
}
