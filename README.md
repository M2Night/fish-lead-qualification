# Fish Lead Qualification — Voice Demo

A standalone, polished voice demo: a prospect talks to **Fish**, a Fish-Audio-voiced
agent that runs a natural sales-discovery conversation. The UI is a Next.js 15 app
built on `@livekit/components-react`, with a language + voice picker — a
**conversation-only** demo (no scorecard, no on-screen transcript).

3 languages (English / Chinese / Japanese). Built on `agent-demo-core` (Deepgram STT /
LLM / Fish s2.1-pro TTS / multilingual turn detection) over LiveKit.

> **Worker moved.** The voice worker's source of truth is now
> `agent-demo-core/agents/lead_qual/` (a uv workspace member, deployed from that repo).
> This repo is the **web frontend + contract**; the `worker/` directory here is retained
> for history only — see `DEPLOY.md §B`.

## Structure

| Path | What |
|------|------|
| `web-next/` | Next.js 15 call UI (`@livekit/components-react`) + the `/api/token` dispatch endpoint. |
| `web/` | **(legacy)** the original static/Express client; superseded by `web-next/`, kept for history. |
| `CONTRACT.md` | The worker ↔ web data contract. |
| `worker/` | **(moved)** now `agent-demo-core/agents/lead_qual/`; kept here for history. |

## Why standalone

This is a **demo / lead-gen product**, not the agent-creation platform. It shares only the
`agent-demo-core` engine; it deliberately does **not** depend on the workbench app.

## Run

See `agent-demo-core/agents/lead_qual/README.md` (worker) and `web-next/README.md` (frontend).
