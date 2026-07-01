# Deploy

Two pieces, deployed separately:

| Piece | Where | What it is |
| --- | --- | --- |
| `web/` | **Vercel** | static demo page + a tiny token/dispatch API (`/api/session`) |
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

> **⚠️ SUPERSEDED — the worker moved to the `agent-demo-core` monorepo.**
>
> The lead-qual worker now lives at `agent-demo-core/agents/lead_qual/` (a uv workspace
> member) and is deployed from **that** repo's root — **not** from `worker/` here.
>
> Why: LiveKit Cloud's remote build has **no build-time credentials**, so a **private
> git *dependency*** (`fishaudio/agent-demo-core`) cannot be cloned during the build.
> Hosting the worker next to the core (workspace/path dep) keeps the core *in the build
> context* instead, so no build-time auth is needed. Deploy with:
>
> ```bash
> cd <agent-demo-core repo root>
> lk agent deploy --config livekit.lead-qual.toml --secrets AGENT_MODULE=agents.lead_qual.main
> ```
>
> The `worker/` directory here is kept for history only and should not be deployed.
> See `agent-demo-core/agents/lead_qual/README.md`. The `lk` mechanics below still apply,
> but run them from the agent-demo-core repo root, not from `worker/`.

### One-time setup

```bash
# Install the LiveKit CLI (macOS)
brew install livekit-cli

# Authenticate the CLI against your LiveKit Cloud project
lk cloud auth          # opens a browser, links the project
```

### Deploy (from the agent-demo-core repo root)

The worker builds from the **agent-demo-core** repo root (`lk` uses the working dir as
the build context); `AGENT_MODULE` selects which agent the shared image runs.

```bash
cd <agent-demo-core repo root>
lk agent deploy --config livekit.lead-qual.toml --secrets AGENT_MODULE=agents.lead_qual.main
```

Redeploy after changes with the same command; tail logs with
`lk agent logs --config livekit.lead-qual.toml`.

### Secrets

Set provider keys as agent secrets on the lead-qual agent (from the agent-demo-core root;
see `agent-demo-core/agents/lead_qual/.env.example`):

- `FISH_API_KEY`, `FISH_VOICE_ID` (fallback voice), `DEEPGRAM_API_KEY`
- LLM: `LLM_PROVIDER` + either `CUSTOM_LLM_*` (self-hosted Gemma) or `OPENROUTER_API_KEY`
- `AGENT_MODULE=agents.lead_qual.main`

> **Do NOT set** `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` as agent
> secrets — LiveKit Cloud injects those automatically.

---

## Why deploy (vs. running locally)

Local runs from Asia to US/JP providers hit TLS resets and latency spikes. Running
the worker in LiveKit Cloud (US) puts it next to Deepgram / OpenRouter / Fish and
the Dallas Gemma endpoint, which removes the instability and is the real fix for
the "LLM keeps breaking" symptom.
