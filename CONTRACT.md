# Worker ↔ Web contract

The single interface both halves must agree on. The **worker** now lives in the
`agent-demo-core` monorepo at `agents/lead_qual/`; this repo is the **web** half.

## Dispatch

- **`agent_name`**: `lead-qual` — the worker registers with it; the web dispatches it. Must match.
- **Dispatch metadata** (web → worker, JSON string) — the worker owns the persona, so the
  web passes only session options:
  ```json
  { "language": "en", "voice": "koi" }
  ```
  - `language` ∈ `en, zh, ja` (UI picker). Default `en`. The worker maps it to a Deepgram
    STT language and a "respond in <language>" instruction.
  - `voice` (optional) — a short **voice key** (`koi` / `finn` / `marlin`), NOT a raw Fish
    id. The worker maps `(language, key)` to a real Fish voice_id from its server-side
    allowlist (`agents/lead_qual/voices.py`); an unknown/absent key falls back to the
    language's default voice (then `FISH_VOICE_ID`). Real ids never reach the browser.

This is a **conversation-only** discovery agent: there is **no scorecard / qualification
data channel** and the agent calls no tools.

## Transcription

There is **no on-screen transcript**. The web listens to `RoomEvent.TranscriptionReceived`
only to flash the pipeline nodes and confirm the agent joined — it renders no caption, so
no client-side emotion-cue stripping is needed. (The agent still emits Fish emotion cues
like `[warm]` for TTS; they are never displayed.)

## Prompts

The persona lives in the worker repo at
`agent-demo-core/agents/lead_qual/prompts/system_prompt.md` — an unnamed Fish Audio sales
engineer (no persona name), tuned from real call data. The per-session language line is
injected by the worker (`main.py`); the prompt file carries persona + discovery + routing
+ guardrails only.
