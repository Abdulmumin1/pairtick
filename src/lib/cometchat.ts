import { CometChat } from "@cometchat/chat-sdk-javascript";
import { CometChatCalls } from "@cometchat/calls-sdk-javascript";
import type { AppConfig, Person } from "./api";

/**
 * Pairtick signalling over CometChat.
 *
 * - Custom messages (persisted): session lifecycle — invite / accept / decline / end.
 * - Transient messages (fire-and-forget): live editor sync, run output, call start.
 * - Text messages: the actual conversation, tagged with the session id in metadata.
 */
export type Signal =
  | { pt: "code"; sessionId: string; code: string; lang: string }
  | { pt: "run"; sessionId: string; output: RunLine[] }
  | { pt: "call"; sessionId: string; action: "start" | "leave"; kind: "voice" | "video" };
export type RunLine = { kind: "log" | "error" | "info"; text: string };

export type Lifecycle = "pairtick.invite" | "pairtick.accept" | "pairtick.decline" | "pairtick.end";

type Handlers = {
  text?: (m: CometChat.TextMessage) => void;
  custom?: (type: Lifecycle, data: { sessionId: string }, from: string) => void;
  signal?: (s: Signal, from: string) => void;
  typing?: (from: string, on: boolean) => void;
  presence?: (uid: string, online: boolean) => void;
  /** websocket (re)connected — anything sent while we were offline must be re-fetched */
  connected?: () => void;
};

const handlers = new Set<Handlers>();
export function listen(h: Handlers) {
  handlers.add(h);
  return () => void handlers.delete(h);
}

let ready: Promise<void> | null = null;

export async function connect(cfg: AppConfig, me: Person, people: Person[] = []) {
  if (ready) return ready;
  ready = (async () => {
    await CometChat.init(
      cfg.appId,
      new CometChat.AppSettingsBuilder().subscribePresenceForAllUsers().setRegion(cfg.region).autoEstablishSocketConnection(true).build(),
    );

    const current = await CometChat.getLoggedinUser();
    if (current && current.getUid() !== me.uid) await CometChat.logout();
    if (!current || current.getUid() !== me.uid) {
      try {
        await CometChat.login(me.uid, cfg.authKey);
      } catch (e: any) {
        if (e?.code !== "ERR_UID_NOT_FOUND") throw e;
        // First run on a fresh app: create the persona with the Auth Key.
        const u = new CometChat.User(me.uid);
        u.setName(me.name);
        u.setMetadata({ title: me.title, pairtickRole: me.role });
        await CometChat.createUser(u, cfg.authKey);
        await CometChat.login(me.uid, cfg.authKey);
      }
    }

    await ensurePersonas(cfg, people).catch(() => {});

    const res = await CometChatCalls.init({ appId: cfg.appId, region: cfg.region.toLowerCase() as "us" | "eu" | "in" });
    if (!res.success) throw new Error(res.error.message);
    const callsUser = CometChatCalls.getLoggedInUser();
    if (callsUser && callsUser.uid !== me.uid) await CometChatCalls.logout();
    if (!CometChatCalls.getLoggedInUser()) await CometChatCalls.login(me.uid, cfg.authKey);

    CometChat.addMessageListener(
      "pairtick",
      new CometChat.MessageListener({
        onTextMessageReceived: (m: CometChat.TextMessage) => handlers.forEach((h) => h.text?.(m)),
        onCustomMessageReceived: (m: CometChat.CustomMessage) => {
          const type = m.getType() as Lifecycle;
          if (!type.startsWith("pairtick.")) return;
          handlers.forEach((h) => h.custom?.(type, m.getCustomData() as { sessionId: string }, m.getSender().getUid()));
        },
        onTransientMessageReceived: (m: CometChat.TransientMessage) => {
          const data = m.getData() as Signal;
          if (!data?.pt) return;
          handlers.forEach((h) => h.signal?.(data, m.getSender().getUid()));
        },
        onTypingStarted: (t: CometChat.TypingIndicator) => handlers.forEach((h) => h.typing?.(t.getSender().getUid(), true)),
        onTypingEnded: (t: CometChat.TypingIndicator) => handlers.forEach((h) => h.typing?.(t.getSender().getUid(), false)),
      }),
    );
    CometChat.addConnectionListener(
      "pairtick-conn",
      new CometChat.ConnectionListener({ onConnected: () => handlers.forEach((h) => h.connected?.()) }),
    );
    CometChat.addUserListener(
      "pairtick-presence",
      new CometChat.UserListener({
        onUserOnline: (u: CometChat.User) => handlers.forEach((h) => h.presence?.(u.getUid(), true)),
        onUserOffline: (u: CometChat.User) => handlers.forEach((h) => h.presence?.(u.getUid(), false)),
      }),
    );
  })();
  ready.catch(() => (ready = null));
  return ready;
}

/** Make sure every demo persona exists so invites and agent messages always have a receiver. */
async function ensurePersonas(cfg: AppConfig, people: Person[]) {
  if (!people.length) return;
  const found = await new CometChat.UsersRequestBuilder().setUIDs(people.map((p) => p.uid)).setLimit(people.length).build().fetchNext();
  const have = new Set(found.map((u) => u.getUid()));
  for (const p of people) {
    if (have.has(p.uid)) continue;
    const u = new CometChat.User(p.uid);
    u.setName(p.name);
    u.setMetadata({ title: p.title, pairtickRole: p.role });
    await CometChat.createUser(u, cfg.authKey).catch(() => {});
  }
}

export async function disconnect() {
  CometChat.removeMessageListener("pairtick");
  CometChat.removeUserListener("pairtick-presence");
  CometChat.removeConnectionListener("pairtick-conn");
  ready = null;
  await Promise.allSettled([CometChat.logout(), CometChatCalls.logout()]);
}

export async function presence(uids: string[]): Promise<Record<string, boolean>> {
  const req = new CometChat.UsersRequestBuilder().setUIDs(uids).setLimit(uids.length).build();
  const users = await req.fetchNext();
  return Object.fromEntries(users.map((u) => [u.getUid(), u.getStatus() === "online"]));
}

export const sendText = (to: string, text: string, sessionId: string) => {
  const m = new CometChat.TextMessage(to, text, CometChat.RECEIVER_TYPE.USER);
  m.setMetadata({ sessionId });
  return CometChat.sendMessage(m) as Promise<CometChat.TextMessage>;
};

export const sendLifecycle = (to: string, type: Lifecycle, sessionId: string) =>
  CometChat.sendCustomMessage(new CometChat.CustomMessage(to, CometChat.RECEIVER_TYPE.USER, type, { sessionId }));

export const sendSignal = (to: string, s: Signal) => {
  try {
    CometChat.sendTransientMessage(new CometChat.TransientMessage(to, CometChat.RECEIVER_TYPE.USER, s));
  } catch {}
};

export const typing = (to: string, on: boolean) => {
  try {
    const t = new CometChat.TypingIndicator(to, CometChat.RECEIVER_TYPE.USER);
    on ? CometChat.startTyping(t) : CometChat.endTyping(t);
  } catch {}
};

export async function history(withUid: string, sessionId: string) {
  const req = new CometChat.MessagesRequestBuilder().setUID(withUid).setLimit(100).setCategories(["message"]).setTypes(["text"]).build();
  const list = (await req.fetchPrevious()) as CometChat.BaseMessage[];
  return list.filter((m) => (m as CometChat.TextMessage).getMetadata?.()?.["sessionId" as keyof object] === sessionId) as CometChat.TextMessage[];
}

export const metaSession = (m: CometChat.TextMessage) => (m.getMetadata() as { sessionId?: string } | undefined)?.sessionId;

if (import.meta.env.DEV) Object.assign(window, { CometChat, CometChatCalls });

export { CometChat, CometChatCalls };
