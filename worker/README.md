# Lead-Qualification Worker

Standalone Python LiveKit voice worker for the Fish lead-qualification demo. It
registers as agent `lead-qual`, runs a multilingual discovery call (Fish s2.1-pro
TTS, Deepgram STT, OpenRouter LLM), and streams structured qualification snapshots
to the web client over a LiveKit data channel.

The engine library (`voice-agent-core`) is a **public git dependency**, pinned to a
commit for reproducible builds (see `[tool.uv.sources]` in `pyproject.toml`). Bump the
pin to update.

## Layout

```
worker/
  pyproject.toml            # uv project; git dep -> M2Night/voice-agent-core (pinned)
  .env.example              # copy to .env and fill in keys
  src/lead_qual_worker/
    main.py                 # entrypoint: agent + session + data-channel emit
    languages.py            # language -> STT language + Fish locale + name table
    qualification.py        # extraction side-call + reducer + publisher
```

Prompts are loaded at runtime from the sibling `../prompts/` directory
(`system_prompt.md`, `runbook.md`, `extraction_prompt.md`) — edit those without
touching the worker.

## Setup

```bash
cd worker
cp .env.example .env        # then fill in the keys below
uv sync
```

Required env (`.env`):

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit project |
| `FISH_API_KEY` | Fish Audio TTS |
| `FISH_VOICE_ID` | **single multilingual** Fish voice id (used for every language) |
| `OPENROUTER_API_KEY` | conversation LLM + extraction side-call |
| `DEEPGRAM_API_KEY` | streaming STT |

Useful overrides: `LLM_MODEL`, `EXTRACTION_MODEL`, `TTS_MODEL`,
`FISH_TTS_LATENCY_MODE`, `GREETING_MODE`. See `.env.example`.

> If `FISH_VOICE_ID` is unset the worker still runs (Fish provider default voice)
> but logs a warning. If `OPENROUTER_API_KEY` is unset the qualification side-call
> is disabled (the call still works, no scorecard data is emitted).

## Run (dev)

```bash
cd worker
uv run python -m lead_qual_worker.main dev
```

Then open <https://agents-playground.livekit.io/>, paste your LiveKit URL,
generate a token (with dispatch metadata `{"language":"en"}`), and talk. The
worker also registers under the explicit dispatch name `lead-qual`, which is what
the demo web app uses.

Lint / import check:

```bash
uv run ruff check
uv run python -c "import lead_qual_worker.main"
```

## Multilingual

The web passes `{"language": "<code>"}` in dispatch metadata. `languages.py` maps
each ISO code to a Deepgram STT language, a Fish locale tag (informational — one
multilingual voice covers all), and a human language name that's appended to the
instructions as a "respond in <language>" line. Default `en` for absent/unknown
codes. Adding a language is a one-row edit in `languages.py`.

Supported out of the box: `en, zh, de, ja, fr, es, ko, ar, ru, pt`.

## Qualification data channel

After each **user** turn the worker fires a best-effort side-call (independent of
the conversation): extract (cheap LLM, JSON mode) → reduce (canonical state) →
publish a full merged snapshot on `topic="qualification"` with a monotonic `seq`.
A final snapshot is emitted on session close. Reducer rules and payload shape are
defined in `../CONTRACT.md`.
