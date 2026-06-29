# Fish Lead Qualification — Voice Demo

A standalone, polished voice demo: a prospect talks to **Fish**, a Fish-Audio-voiced
agent that runs a natural lead-qualification conversation. The UI shows a live transcript
and a qualification scorecard (use case · authority · volume · timeline) that fills in
real time, with a buying-intent score and a **QUALIFIED** verdict.

Multilingual (Fish's ~10 languages). Built on `voice-agent-core` (Deepgram STT /
OpenRouter LLM / Fish s2.1-pro TTS / multilingual turn detection) over LiveKit.

## Structure

| Path | What |
|------|------|
| `worker/` | Python LiveKit agent — lead-qual persona + per-turn qualification extraction. |
| `web/` | Static demo client (LiveKit) + a small token/dispatch endpoint. |
| `prompts/` | The agent's system prompt, runbook, and extraction prompt (editable). |
| `CONTRACT.md` | The worker ↔ web data contract. |

## Why standalone

This is a **demo / lead-gen product**, not the agent-creation platform. It shares only the
`voice-agent-core` engine; it deliberately does **not** depend on the workbench app.

## Run

See `worker/README.md` and `web/README.md`.
