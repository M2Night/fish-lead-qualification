# Deploy

Two pieces, deployed separately:

| Piece | Where | What it is |
| --- | --- | --- |
| `web/` | **Vercel** | static demo page + a tiny token/dispatch API (`/api/session`, `/api/warmup`) |
| `worker/` (incl. `worker/prompts/`) | **LiveKit Cloud Agents** | the `lead-qual` voice worker (Deepgram STT · Gemma/OpenRouter LLM · Fish TTS) |

The browser only ever gets a short-lived LiveKit participant JWT. All provider keys
live server-side (Vercel env for the web, LiveKit agent secrets for the worker).

---

## A. Web → Vercel

The Express app is exported as a serverless function (`web/vercel.json`,
`module.exports = app`), and `public/` ships with it.

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. In Vercel: **Add New… → Project → Import** this repo.
3. **Set Root Directory to `web`** (important — the app lives in `web/`, not the repo root).
   Framework preset: **Other**. Leave build/output empty; `vercel.json` handles it.
4. Add Environment Variables (Production + Preview):
   - `LIVEKIT_URL` — `wss://<your-project>.livekit.cloud`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
5. **Deploy.** Visit the URL; the page loads and "Start call" mints a token +
   dispatches the `lead-qual` agent.

> The web app and the worker must point at the **same** LiveKit project (same
> `LIVEKIT_URL` / key / secret), otherwise the dispatch lands nowhere.

---

## B. Worker → LiveKit Cloud Agents

Deploys with the `lk` CLI from the **`worker/` directory** — a self-contained
LiveKit agent project (`pyproject.toml` + `uv.lock` + `src/` + `prompts/` +
`Dockerfile`).

### One-time setup

```bash
# Install the LiveKit CLI (macOS)
brew install livekit-cli

# Authenticate the CLI against your LiveKit Cloud project
lk cloud auth          # opens a browser, links the project
```

### First deploy

Run from `worker/`. Pick the project the web app uses, and the US region:

```bash
cd worker
lk agent create . --project fish-audio-demo --region us-east --secrets-file .env
```

This builds the image (US-region build), registers an agent, writes a
`livekit.toml` (commit it afterward), and starts the worker. The worker registers
as `agent_name="lead-qual"`, matching what the web dispatches.

> `--secrets-file .env` injects the provider keys but **also** `LIVEKIT_*`; that's
> fine for create, but if you regenerate secrets later strip `LIVEKIT_URL` /
> `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — LiveKit Cloud injects those itself.

### Secrets

The worker needs provider keys at runtime. Set them as agent secrets — either pass
the env file at create time (as above) or update them later (run from `worker/`):

```bash
lk agent update-secrets --secrets-file .env
```

Required secrets (see `worker/.env.example`):

- `FISH_API_KEY`, `FISH_VOICE_ID`
- `DEEPGRAM_API_KEY`
- `OPENROUTER_API_KEY` (qualification side-call; also the `openrouter` LLM provider)
- `LLM_PROVIDER` (`custom` = self-hosted OpenAI-compatible endpoint, `openrouter`, or
  `livekit`)
- `CUSTOM_LLM_BASE_URL`, `CUSTOM_LLM_API_KEY`, `CUSTOM_LLM_MODEL` (Gemma SGLang
  endpoint — the low-latency conversation LLM, used when `LLM_PROVIDER=custom`)
- `LLM_MODEL` (model id for the `openrouter` / `livekit` providers; distinct from
  `CUSTOM_LLM_MODEL` so the two never conflict)
- optional tuning: `CUSTOM_LLM_MAX_TOKENS` (default 0 = no cap; 60 recommended for
  voice), `IDLE_MAX_NUDGES` (default 2),
  `NUM_IDLE_PROCESSES` (default 1), `TURN_DETECTION_MODE=multilingual`,
  `FISH_TTS_LATENCY_MODE=low`, `PREEMPTIVE_GENERATION=true`

> **Do NOT set** `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` as agent
> secrets — LiveKit Cloud injects those automatically for the agent.

### Redeploy after code changes

```bash
lk agent deploy
```

### Watch logs

```bash
lk agent logs
```

---

## Why deploy (vs. running locally)

Local runs from Asia to US/JP providers hit TLS resets and latency spikes. Running
the worker in LiveKit Cloud (US) puts it next to Deepgram / OpenRouter / Fish and
the Dallas Gemma endpoint, which removes the instability and is the real fix for
the "LLM keeps breaking" symptom.
