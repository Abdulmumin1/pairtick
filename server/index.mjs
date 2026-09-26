import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { config, PEOPLE, PLATFORM_FEE, AGENT_UID } from "./config.mjs";
import * as L from "./ledger.mjs";
import { streamAgent, estimateTokens, postAgentMessage, ensureUsers, restEnabled } from "./agent.mjs";

const DIST = resolve(process.cwd(), "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch {
        ok({});
      }
    });
  });

function sse(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(": ok\n\n");
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const routes = [
  ["GET", /^\/api\/config$/, () => ({
    appId: config.appId,
    region: config.region,
    authKey: config.authKey,
    configured: Boolean(config.appId && config.region && config.authKey),
    rest: restEnabled(),
    llm: config.llm,
    agentUid: AGENT_UID,
    platformFee: PLATFORM_FEE,
  })],
  ["GET", /^\/api\/people$/, () => PEOPLE.map((p) => ({ ...p, balance: L.balance(p.uid) }))],
  ["GET", /^\/api\/wallet\/([\w-]+)$/, (_q, [uid]) => ({ uid, balance: L.balance(uid) })],
  ["POST", /^\/api\/wallet\/([\w-]+)\/topup$/, (_q, [uid], b) => ({ uid, balance: L.topup(uid, Number(b.amount) || 0) })],
  ["POST", /^\/api\/wallet\/([\w-]+)\/set$/, (_q, [uid], b) => {
    if (process.env.PAIRTICK_DEMO === "0") throw Object.assign(new Error("demo controls disabled"), { status: 403 });
    return { uid, balance: L.setBalance(uid, Number(b.amount) || 0) };
  }],
  ["POST", /^\/api\/sessions$/, (_q, _p, b) => L.createSession(b)],
  ["GET", /^\/api\/sessions$/, (q) => L.listSessions({ uid: q.get("uid"), status: q.get("status") })],
  ["GET", /^\/api\/sessions\/([\w-]+)$/, (_q, [id]) => L.getSession(id) ?? Promise.reject(Object.assign(new Error("not found"), { status: 404 }))],
  ["POST", /^\/api\/sessions\/([\w-]+)\/accept$/, (_q, [id]) => L.accept(id)],
  ["POST", /^\/api\/sessions\/([\w-]+)\/decline$/, (_q, [id]) => L.end(id, "declined")],
  ["POST", /^\/api\/sessions\/([\w-]+)\/end$/, (_q, [id], b) => L.end(id, b.reason || "ended")],
  ["POST", /^\/api\/sessions\/([\w-]+)\/tick$/, (_q, [id], b) => L.tick(id, b)],
  ["POST", /^\/api\/sessions\/([\w-]+)\/message$/, (_q, [id]) => L.chargeMessage(id)],
];

async function agentStream(req, res, id) {
  const b = await readBody(req);
  const s = L.getSession(id);
  if (!s || s.kind !== "agent") return json(res, 404, { error: "no agent session" });
  const send = sse(res);
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  // Input tokens are billed up front: prompt + editor context.
  let r = L.chargeTokens(id, estimateTokens(b.prompt) + estimateTokens(b.code));
  send("meter", r.snap);
  if (!r.ok) {
    send("done", { text: "", cutoff: true });
    return res.end();
  }

  let text = "";
  let cutoff = false;
  try {
    await streamAgent(
      b,
      (delta) => {
        text += delta;
        r = L.chargeTokens(id, estimateTokens(delta));
        send("delta", { delta, snap: r.snap });
        if (!r.ok) {
          cutoff = true;
          return false;
        }
      },
      ac.signal,
    );
  } catch (e) {
    if (!ac.signal.aborted) send("error", { message: e.message });
  }

  if (cutoff) text += "\n\n— stopped: wallet empty —";
  let persisted = null;
  if (text.trim()) {
    try {
      persisted = await postAgentMessage({ to: s.clientUid, text, metadata: { sessionId: id, pairtick: true } });
    } catch (e) {
      console.warn("agent persist failed:", e.message);
    }
  }
  send("done", { text, cutoff, persisted });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;

  try {
    if (req.method === "GET" && (path.match(/^\/api\/sessions\/([\w-]+)\/stream$/))) {
      const id = path.split("/")[3];
      const first = L.getSession(id);
      if (!first) return json(res, 404, { error: "not found" });
      const send = sse(res);
      send("snap", first);
      const off = L.subscribe(id, (snap) => send("snap", snap));
      const ka = setInterval(() => res.write(": ka\n\n"), 15000);
      req.on("close", () => (off(), clearInterval(ka)));
      return;
    }
    const agentMatch = req.method === "POST" && path.match(/^\/api\/sessions\/([\w-]+)\/agent$/);
    if (agentMatch) return agentStream(req, res, agentMatch[1]);

    for (const [method, re, fn] of routes) {
      const m = req.method === method && path.match(re);
      if (!m) continue;
      const body = method === "POST" ? await readBody(req) : {};
      return json(res, 200, await fn(url.searchParams, m.slice(1), body));
    }

    if (path.startsWith("/api/")) return json(res, 404, { error: "not found" });

    // Static (production build)
    if (existsSync(DIST)) {
      let file = join(DIST, path === "/" ? "index.html" : path);
      if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) file = join(DIST, "index.html");
      const hashed = file.includes(`${join(DIST, "assets")}`);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] || "application/octet-stream",
        "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      });
      return res.end(await readFile(file));
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, e.status || 400, { error: e.message });
  }
});

server.listen(config.port, "0.0.0.0", async () => {
  console.log(`pairtick server → http://localhost:${config.port}`);
  console.log(`  cometchat: ${config.appId ? `${config.appId} (${config.region})` : "NOT CONFIGURED — see README"}`);
  console.log(`  rest key:  ${restEnabled() ? "yes (agent replies persisted to CometChat)" : "no (agent replies stay local)"}`);
  console.log(`  llm:       ${config.llm}`);
  await ensureUsers();
});
