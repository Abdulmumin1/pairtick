import { config, AGENT_UID, PEOPLE } from "./config.mjs";

const SYSTEM = `You are Tick, a concise senior pair programmer inside a metered live-coding session.
The user pays per token, so be brief and precise: lead with the fix, show only the code that changes,
and skip pleasantries. Use fenced code blocks with a language tag. The user's current editor
buffer is provided; refer to line numbers when useful.`;

export const estimateTokens = (s) => Math.max(1, Math.ceil((s || "").length / 4));

/**
 * Streams a reply. Calls onDelta(text) for each chunk; return false from
 * onDelta to abort (e.g. wallet ran dry mid-stream).
 */
export async function streamAgent({ prompt, code, lang, history = [] }, onDelta, signal) {
  const context = `Editor (${lang || "javascript"}):\n\`\`\`${lang || "javascript"}\n${numbered(code)}\n\`\`\``;
  const msgs = [
    ...history.slice(-8).map((h) => ({ role: h.role === "agent" ? "assistant" : "user", content: h.text })),
    { role: "user", content: `${context}\n\n${prompt}` },
  ];

  let sent = false;
  const track = (d) => ((sent = true), onDelta(d));
  try {
    if (config.llm === "anthropic") return await streamAnthropic(msgs, track, signal);
    if (config.llm === "openai") return await streamOpenAI(msgs, track, signal);
    if (config.llm === "gemini")
      // Gemini's OpenAI-compatible endpoint. Low reasoning keeps first-token latency
      // short; thinking tokens count toward the budget, so it's larger here.
      return await streamOpenAI(msgs, track, signal, {
        base: "https://generativelanguage.googleapis.com/v1beta/openai",
        key: config.geminiKey,
        model: config.geminiModel,
        extra: { reasoning_effort: "low", max_tokens: 2048 },
      });
  } catch (e) {
    if (sent || signal?.aborted) throw e;
    console.warn("LLM failed, falling back to offline reviewer:", e.message.slice(0, 120));
  }
  return streamMock({ prompt, code, lang }, onDelta, signal);
}

function numbered(code = "") {
  return code
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)
    .join("\n");
}

async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

async function streamOpenAI(messages, onDelta, signal, opts = {}) {
  const { base = config.openaiBase, key = config.openaiKey, model = config.openaiModel, extra = {} } = opts;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 700,
      ...extra,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  for await (const data of sseLines(res)) {
    if (data === "[DONE]") break;
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta && onDelta(delta) === false) return;
    } catch {}
  }
}

async function streamAnthropic(messages, onDelta, signal) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 700, stream: true, system: SYSTEM, messages }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  for await (const data of sseLines(res)) {
    try {
      const ev = JSON.parse(data);
      if (ev.type === "content_block_delta" && ev.delta?.text) {
        if (onDelta(ev.delta.text) === false) return;
      }
    } catch {}
  }
}

// Offline fallback so the demo works without an LLM key: a small static
// reviewer that actually reads the editor buffer.
async function streamMock({ prompt, code = "" }, onDelta, signal) {
  const lines = code.split("\n");
  const notes = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    if (/\bvar\s/.test(l)) notes.push(`L${n}: \`var\` is function-scoped — use \`let\`/\`const\`.`);
    if (/[^=!]==[^=]/.test(l)) notes.push(`L${n}: loose \`==\` coerces types — prefer \`===\`.`);
    const oob = l.match(/for\s*\(.*<=\s*(\w+)\.length/);
    if (oob) notes.push(`L${n}: \`<= ${oob[1]}.length\` reads one past the end (\`${oob[1]}[${oob[1]}.length]\` is undefined → NaN) — use \`<\`.`);
    if (/fetch\(/.test(l) && !/catch|try/.test(code)) notes.push(`L${n}: \`fetch\` has no error handling — check \`res.ok\` and catch.`);
    if (/\.forEach\(\s*async/.test(l)) notes.push(`L${n}: \`forEach(async …)\` doesn't await — use \`for…of\` or \`Promise.all\`.`);
    if (/setState\(.*\+\+/.test(l)) notes.push(`L${n}: mutating inside setState — use the updater form.`);
  });
  const fnName = code.match(/function\s+(\w+)/)?.[1] || code.match(/const\s+(\w+)\s*=\s*\(/)?.[1];
  let text;
  if (notes.length) {
    text = `Read ${lines.length} lines${fnName ? ` around \`${fnName}\`` : ""}. Found ${notes.length} issue${notes.length > 1 ? "s" : ""}:\n\n${notes
      .slice(0, 5)
      .map((n) => "- " + n)
      .join("\n")}\n\nFix the first one and hit Run — the output panel will tell us if it holds.`;
  } else if (code.trim()) {
    text = `Read ${lines.length} lines. Nothing obviously wrong${fnName ? ` in \`${fnName}\`` : ""}.\n\nFor "${prompt.slice(0, 80)}" — add a quick assertion so we can verify:\n\n\`\`\`js\nconsole.assert(${fnName || "result"} !== undefined, "should return a value");\n\`\`\`\n\nRun it and I'll look at the output. (Mock agent — set OPENAI_API_KEY or ANTHROPIC_API_KEY for a real model.)`;
  } else {
    text = `The editor is empty. Paste the code you're stuck on and tell me what you expected vs. what happened.`;
  }
  for (const piece of text.match(/\S+\s*/g) || []) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 28));
    if (onDelta(piece) === false) return;
  }
}

// ---------- CometChat REST (server-side, needs REST API key) ----------

const base = () => `https://${config.appId}.api-${config.region}.cometchat.io/v3`;

async function rest(path, { method = "GET", body, onBehalfOf } = {}) {
  const headers = { apikey: config.restKey, "content-type": "application/json", accept: "application/json" };
  if (onBehalfOf) headers.onBehalfOf = onBehalfOf;
  const res = await fetch(base() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || res.statusText), { code: json?.error?.code });
  return json;
}

export const restEnabled = () => Boolean(config.restKey && config.appId && config.region);

/** Posts the finished agent reply into the CometChat conversation as the agent user. */
export async function postAgentMessage({ to, text, metadata }) {
  if (!restEnabled()) return null;
  const r = await rest("/messages", {
    method: "POST",
    onBehalfOf: AGENT_UID,
    body: { receiver: to, receiverType: "user", category: "message", type: "text", data: { text, metadata } },
  });
  return r.data?.id ?? null;
}

export async function ensureUsers() {
  if (!restEnabled()) return;
  for (const p of PEOPLE) {
    try {
      await rest("/users", {
        method: "POST",
        body: { uid: p.uid, name: p.name, role: "default", metadata: { title: p.title, pairtickRole: p.role } },
      });
      console.log("  created user", p.uid);
    } catch (e) {
      if (e.code !== "ERR_UID_ALREADY_EXISTS") console.warn("  user", p.uid, e.message);
    }
  }
}
