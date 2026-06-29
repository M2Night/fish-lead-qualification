# Fish Lead Qualification — LiveKit voice worker image.
#
# Build context MUST be the repo root: the worker loads prompts from
# `<repo>/prompts` at runtime (main.py resolves `parents[3]/prompts`), so the
# image needs BOTH `worker/` and `prompts/`. Deploy with `lk agent create .`
# (or `lk agent deploy`) run from the repo root.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# git: voice-agent-core is pulled as a git dependency. ca-certificates: TLS to the
# STT/LLM/TTS providers at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app/worker

# 1) Resolve deps first (cached layer) from just the manifest + lockfile.
COPY worker/pyproject.toml worker/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# 2) App source + the prompts the worker reads at runtime.
COPY worker/ /app/worker/
COPY prompts/ /app/prompts/

# 3) Install the project itself against the resolved env.
RUN uv sync --frozen --no-dev

# Pre-download plugin model files (Silero VAD, multilingual turn detector) into the
# image so the first call doesn't pay the download cost. Best-effort.
RUN uv run python -m lead_qual_worker.main download-files || true

# LiveKit Cloud injects LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET; the
# provider keys (FISH_API_KEY, OPENROUTER_API_KEY, DEEPGRAM_API_KEY, LLM_*,
# FISH_VOICE_ID) come from the agent's secrets (see DEPLOY.md).
CMD ["uv", "run", "python", "-m", "lead_qual_worker.main", "start"]
