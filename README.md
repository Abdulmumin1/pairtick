# pairtick

**Senior help, billed by the second.** A browser playground where a junior dev or client opens a session with an expert engineer or an AI pair programmer. You get a shared editor, chat, and voice/video, and the meter runs live. Money moves 5 times a second at the rate for whatever is actually streaming. Turn the camera off and the rate drops right away. Hang up and billing stops. If the wallet runs out, the session ends by itself.

Built for CometChat **Zero to Chat** (#ZeroToChat).

**Live:** https://pairtick-production.up.railway.app. Open it as **Ada** in one browser and **Grace** in a private window.

## What's in it

| | |
|---|---|
| **Sub-second metering** | The payer's client ticks the ledger every 200 ms. The server charges `rate[mode] × Δt` using its own clock. It won't bill a gap longer than 1.5 s, so a sleeping tab or dropped network costs nothing. |
| **Mode-aware rates** | `chat` → `voice` → `video`, based on real call state: participants ≥ 2 and whether the payer's camera is on. |
| **Frames metered** | `requestVideoFrameCallback` counts the decoded frames in the CometChat call container. The count goes out with every tick and shows up on the receipt. |
| **Streamed AI billing** | Tick, the AI pair, reads the editor buffer. Its reply streams over SSE and each chunk is billed as it arrives. Press Stop and billing stops. If the wallet hits $0 mid-answer, the reply is cut off. |
| **Live collaboration** | Editor keystrokes, run output and call invites travel as CometChat transient messages. |
| **Payouts** | The expert gets 80% of every tick. The platform keeps 20%. Both sides watch their numbers move. |
| **Receipt** | Line items for chat, voice and video time, message count, tokens and frames. |

## How CometChat is used

- **Chat SDK** (`@cometchat/chat-sdk-javascript`): login, presence, typing indicators, and text messages tagged with `metadata.sessionId`.
  - **Custom messages** handle the session lifecycle: `pairtick.invite`, `accept`, `decline`, `end`.
  - **Transient messages** carry realtime signals (code sync, run output, call start). They aren't stored, so they're cheap.
- **Calls SDK v5** (`@cometchat/calls-sdk-javascript`): `generateToken` → `joinSession` in SPOTLIGHT layout with the default control panel hidden. The app draws its own controls: mute, camera, screen share, leave. Events such as `onParticipantListChanged` and `onVideoPaused` set the billing mode.
- **REST API** (optional): creates the demo users. With `onBehalfOf: pairtick-agent` it posts the AI's finished replies into the real CometChat conversation.
- **CometChat MCP**: the docs, the JS SDK bundle, the Calls v5 pages and the REST reference were all pulled from `https://mcp.cometchat.com/mcp` while building this.

## Run it

```bash
npm install

# 1. Get CometChat credentials (free tier works). This writes .cometchat/config.json
npx @cometchat/skills-cli@3 auth login
npx @cometchat/skills-cli@3 provision run
#    …or: cp .env.example .env and fill COMETCHAT_APP_ID / REGION / AUTH_KEY

# 2. Start the API (:8787) and web app (:5173)
npm run dev
```

Open http://localhost:5173 and pick **Ada** (client). Then open a **private window** or another browser and pick **Grace** (expert). The CometChat SDK keeps its session in localStorage, so two tabs in the same profile will fight over it.

The demo users are created the first time you log in, using the Auth Key. Each client starts with a $5 test wallet. Use **Test funds** in the top bar to set it to $0.20 / $1 / $5 / $20. Pick $0.20 and start a video call to watch the session end itself at $0.00.

### Optional

| env | effect |
|---|---|
| `COMETCHAT_REST_API_KEY` | AI replies are saved to the CometChat conversation and still there after a reload |
| `GEMINI_API_KEY` (+ `GEMINI_MODEL`, default `gemini-3.8-flash`) | Gemini for Tick, via Google's OpenAI-compatible endpoint. Key from Google AI Studio |
| `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`, `OPENAI_MODEL`) | real LLM for Tick; works with any OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | Claude for Tick |
| `PAIRTICK_LLM=mock\|gemini\|openai\|anthropic` | pick a provider explicitly (default order: gemini, openai, anthropic). `mock` forces the offline reviewer. It really reads the code and finds `var`, `==`, off-by-one loops, un-awaited `forEach`, and so on |

If the LLM call fails, Tick switches to the offline reviewer, so the demo keeps working.

### Production

```bash
npm run build && npm start   # one process on :8787 serves the API + dist/
```

Camera and mic need HTTPS anywhere other than localhost.

**Railway:** `railway up` uses `railway.json`, which builds with `npm run build`, starts with `npm start`, and health-checks `/api/config`. Set these variables:
- `COMETCHAT_APP_ID`, `COMETCHAT_REGION`, `COMETCHAT_AUTH_KEY`
- optionally `COMETCHAT_REST_API_KEY` and `GEMINI_API_KEY`
- `PAIRTICK_DATA_DIR=/data`, pointing at a mounted volume so wallets survive redeploys

Set `PAIRTICK_DEMO=0` to disable the test-funds endpoint.

## 90-second demo script

1. **(0–10s)** Ada's home screen. Show the rate cards (per second) and the $5 wallet.
2. **(10–25s)** Click **Start** on Grace. The meter says *waiting, not charged*. In the other window Grace gets a notification and clicks **Accept**. The meter starts at the chat rate.
3. **(25–45s)** Grace types a fix into the shared editor and it shows up live for Ada. Ada presses **Run**, and the output (`average: NaN`) appears on both sides.
4. **(45–60s)** Click **Video**. Grace auto-joins and the rate pill switches to `video $0.014/s`. Turn off Ada's camera and the rate drops to voice straight away. Watch the sparkline step down.
5. **(60–75s)** Go back home and start a session with **Tick** (AI). Ask *"why is my average NaN?"*. The answer streams in and the token count and cost go up with every chunk.
6. **(75–90s)** Set Ada's test funds to **$0.20** and start a video call. When the wallet hits $0.00 the call drops and the receipt says *stopped automatically*. Alternatively, click **End** to show the receipt: chat, voice and video time, frames, messages, tokens and total. Show the CometChat MCP connector in your editor.

## Layout

```
server/
  index.mjs    HTTP API + SSE (session snapshots, agent stream), serves dist/
  ledger.mjs   wallets, sessions, tick metering, 80/20 split, µ$ integer math
  agent.mjs    LLM streaming (OpenAI/Anthropic/mock), CometChat REST
  config.mjs   personas + rate cards
src/
  lib/cometchat.ts   Chat + Calls init/login, signalling helpers
  lib/api.ts         ledger client, SSE agent stream, formatting
  lib/frames.ts      video frame counter
  lib/runner.ts      sandboxed iframe JS runner
  components/        Room, Meter, Editor, Chat, Call, homes
```

Amounts are stored as integer micro-dollars. The ledger lives in `data/ledger.json`; delete it to reset the demo.
