# Fish Lead Qualification — Voice Demo

A standalone, polished voice demo: a prospect talks to **Fish**, a Fish-Audio-voiced
agent that runs a natural lead-qualification conversation. The UI shows a live transcript
and a qualification scorecard (use case · authority · volume · timeline) that fills in
real time, with a buying-intent score and a **QUALIFIED** verdict.

Multilingual (Fish's ~10 languages). Built on `agent-demo-core` (Deepgram STT /
OpenRouter LLM / Fish s2.1-pro TTS / multilingual turn detection) over LiveKit.

> **Worker moved.** The voice worker's source of truth is now
> `agent-demo-core/agents/lead_qual/` (a uv workspace member, deployed from that repo).
> This repo is the **web frontend + contract**; the `worker/` directory here is retained
> for history only — see `DEPLOY.md §B`.

## Structure

| Path | What |
|------|------|
| `web/` | Static demo client (LiveKit) + a small token/dispatch endpoint. |
| `CONTRACT.md` | The worker ↔ web data contract. |
| `worker/` | **(moved)** now `agent-demo-core/agents/lead_qual/`; kept here for history. |

## Why standalone

This is a **demo / lead-gen product**, not the agent-creation platform. It shares only the
`agent-demo-core` engine; it deliberately does **not** depend on the workbench app.

## Run

See `worker/README.md` and `web/README.md`.
