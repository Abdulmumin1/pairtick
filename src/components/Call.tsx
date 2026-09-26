import { useEffect, useRef, type MutableRefObject } from "react";
import { CometChatCalls } from "../lib/cometchat";
import { frameCounter } from "../lib/frames";

export type CallState = {
  joined: boolean;
  participants: number;
  audioMuted: boolean;
  videoPaused: boolean;
  sharing: boolean;
  error?: string;
};
export const initialCall: CallState = { joined: false, participants: 0, audioMuted: false, videoPaused: false, sharing: false };

/**
 * Mounts a CometChat Calls v5 session into a container. The session id is
 * derived from the pairtick session so both sides land in the same room.
 * The default control panel is hidden; the room renders its own controls.
 */
export function Call({
  sessionId,
  kind,
  onState,
  frames,
}: {
  sessionId: string;
  kind: "voice" | "video";
  onState: (fn: (s: CallState) => CallState) => void;
  frames: MutableRefObject<ReturnType<typeof frameCounter> | null>;
}) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current!;
    let cancelled = false;
    const me = CometChatCalls.getLoggedInUser()?.uid;
    const offs = [
      CometChatCalls.addEventListener("onSessionJoined", () => onState((s) => ({ ...s, joined: true }))),
      CometChatCalls.addEventListener("onSessionLeft", () => onState(() => initialCall)),
      // Count remote people explicitly — the list may or may not include the local user.
      CometChatCalls.addEventListener("onParticipantListChanged", (list) => {
        const remote = new Set(list.map((p) => p.uid).filter((uid) => uid && uid !== me));
        onState((s) => ({ ...s, participants: remote.size + 1 }));
      }),
      CometChatCalls.addEventListener("onParticipantJoined", (p: { uid?: string }) => {
        if (p?.uid && p.uid !== me) onState((s) => ({ ...s, participants: Math.max(s.participants, 2) }));
      }),
      CometChatCalls.addEventListener("onParticipantLeft", (p: { uid?: string }) => {
        if (p?.uid && p.uid !== me) onState((s) => ({ ...s, participants: 1 }));
      }),
      CometChatCalls.addEventListener("onAudioMuted", () => onState((s) => ({ ...s, audioMuted: true }))),
      CometChatCalls.addEventListener("onAudioUnMuted", () => onState((s) => ({ ...s, audioMuted: false }))),
      CometChatCalls.addEventListener("onVideoPaused", () => onState((s) => ({ ...s, videoPaused: true }))),
      CometChatCalls.addEventListener("onVideoResumed", () => onState((s) => ({ ...s, videoPaused: false }))),
      CometChatCalls.addEventListener("onScreenShareStarted", () => onState((s) => ({ ...s, sharing: true }))),
      CometChatCalls.addEventListener("onScreenShareStopped", () => onState((s) => ({ ...s, sharing: false }))),
    ];
    frames.current = frameCounter(el);

    (async () => {
      try {
        const { token } = await CometChatCalls.generateToken(`pairtick-${sessionId}`);
        if (cancelled) return;
        const res = await CometChatCalls.joinSession(
          token,
          {
            sessionType: kind === "video" ? "VIDEO" : "VOICE",
            layout: "SPOTLIGHT",
            startAudioMuted: false,
            startVideoPaused: kind !== "video",
            hideControlPanel: true,
            idleTimeoutPeriodBeforePrompt: 10 * 60_000,
          },
          el,
        );
        if (res.error) throw new Error(res.error.message);
      } catch (e: any) {
        onState((s) => ({ ...s, error: e?.message || "Could not join call" }));
      }
    })();

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      frames.current?.stop();
      frames.current = null;
      try {
        CometChatCalls.leaveSession();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, kind]);

  return <div ref={stage} className="call-stage" />;
}
