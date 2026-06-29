# Web — Fish Lead Qualification demo client

A small Node + Express app that serves the polished voice-demo page and mints
LiveKit credentials. The browser talks to **Fish** (the `lead-qual` agent) over
LiveKit; the page shows a live transcript and a self-filling qualification
scorecard (use case · authority · volume · timeline), a buying-intent score, and
a **QUALIFIED** verdict.

## What's here

| File | What |
|------|------|
| `server.js` | Express server. Serves `public/`, exposes `POST /api/session`. |
| `public/index.html` | The demo UI — a real `livekit-client` browser client (CDN). |
| `.env.example` | LiveKit credentials template. |

## `POST /api/session`

Body: `{ "language": "en" }` (one of `en zh de ja fr es ko ar ru pt`; defaults to
`en` if absent/invalid).

It mints a participant token (`roomJoin` + `canPublish` + `canSubscribe` +
`canPublishData`) and dispatches the agent `agent_name="lead-qual"` with
`metadata = {"language": "<lang>"}` (per `../CONTRACT.md`). Returns:

```json
{ "livekitUrl": "...", "roomName": "lead-qual-xxxxxxxx", "token": "..." }
```

LiveKit API keys stay server-side; the browser only ever receives the JWT.

## Run

```bash
cd web
cp .env.example .env      # then fill in LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
npm install
npm run dev               # http://localhost:3000  (set PORT to override)
```

The page loads and animates without keys, but **Start call** needs valid
`LIVEKIT_*` env (and the `lead-qual` worker running) to actually connect.

## How the UI is wired

- **Start / End call** drive a state machine: `idle → connecting → cold start →
  connected → ended / error`. The `idle/live` dot and a mono status label reflect
  it. A ~30s agent-ready watchdog turns into an error if no agent joins.
- **Transcript** comes from `RoomEvent.TranscriptionReceived`; segments upsert by
  `id` so interim text updates in place, agent vs user styling is kept, and the
  newest line types in word-by-word. Emotion markers like `(warm)` / `[whisper]`
  are stripped before display.
- **Scorecard / score / verdict** come from `RoomEvent.DataReceived`. A frame is
  treated as qualification only if `topic === "qualification"` **or** parsed
  `kind === "qualification"`; stale `seq <= lastSeq` frames are ignored; slots are
  field-adapted (`use_case→useCase`, `authority→role`). `QUALIFIED` glows the card
  and fires sparkles.
- **Audio**: the agent's remote audio track (`TrackSubscribed`, kind audio) is
  attached to a hidden `<audio autoplay>`. If the browser blocks autoplay, a
  one-tap **enable audio** button appears (`startAudio()` on a gesture).
- **Speaking state**: `ActiveSpeakersChanged` (agent present) bumps a `speakingT`
  timestamp that speeds up the Fish swim and lights the center voice meter +
  sparkles. With no call, only idle visuals animate.

## Language dropdown → dispatch

The dropdown's value (the Fish language code) is POSTed to `/api/session` as
`{ language }`, JSON-stringified into the dispatch metadata, and the worker maps
it to STT language + Fish voice/locale.
