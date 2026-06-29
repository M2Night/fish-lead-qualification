"""Standalone LiveKit voice worker for the Fish lead-qualification demo.

Wiring (canonical voice-agent-core template — see ``examples/smoke_agent.py``):

    settings subclass -> default_prewarm -> build_pipeline -> build_session
    -> Agent(instructions=...) -> session.start(...)

What this worker adds on top of that template:

- registers as ``agent_name="lead-qual"`` (the CONTRACT.md dispatch name);
- reads ``{"language": "<code>"}`` from dispatch metadata and maps it (one table
  in ``languages.py``) to a Deepgram STT language + a "respond in <language>"
  instruction line; the Fish voice is a single multilingual voice via
  ``FISH_VOICE_ID``;
- loads the persona from ``prompts/system_prompt.md`` and private rubric from
  ``prompts/runbook.md`` at runtime;
- on each **user** turn, fires a best-effort qualification side-call (see
  ``qualification.py``) that extracts -> reduces -> publishes a snapshot on the
  ``qualification`` data channel, and emits a final snapshot on session close.

Secrets come from env (``FISH_API_KEY`` / ``OPENROUTER_API_KEY`` /
``DEEPGRAM_API_KEY`` / LiveKit creds). Only the per-session ``language`` comes
from dispatch metadata.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Literal

from livekit.agents import Agent, AgentServer, JobContext, cli
from pydantic import Field
from voice_agent_core import (
    BaseAgentSettings,
    OpenRouterSettings,
    build_pipeline,
    build_session,
    default_prewarm,
    default_room_options,
    format_transcript,
    get_logger,
    is_warmup_session,
    load_env_walking_up,
    setup_observability,
)

from lead_qual_worker.languages import resolve_language, supported_languages
from lead_qual_worker.qualification import (
    QualificationExtractor,
    QualificationPublisher,
    build_extraction_client,
)

log = get_logger(__name__)

AGENT_NAME = "lead-qual"
PROMPTS_DIR = Path(__file__).resolve().parents[3] / "prompts"

# Voice-output discipline appended to the persona so the LLM emits clean spoken
# text (Fish renders emotion markers like "(warm)"; the web strips them before
# display, per CONTRACT.md).
VOICE_OUTPUT_RULES = (
    "Voice output rules: this is a spoken audio conversation. Emit plain spoken "
    "text only — no markdown, asterisks, backticks, headings, bullet lists, or "
    "URL-shaped text."
)

# Short localized openers (TTS-only first utterance = lowest first-token latency).
# Falls back to English for languages without a tuned opener.
_OPENERS: dict[str, str] = {
    "en": "Hey, thanks for hopping on. What are you building that needs voice?",
    "zh": "嗨，谢谢你抽空过来。你们在做什么需要语音的项目呢？",
    "de": "Hi, schön dass du da bist. Woran arbeitest du, das Sprache braucht?",
    "ja": "やあ、お時間ありがとう。音声が必要な何を作っているんですか？",
    "fr": "Salut, merci d'être là. Sur quoi travailles-tu qui a besoin de voix ?",
    "es": "Hola, gracias por conectarte. ¿Qué estás construyendo que necesita voz?",
    "ko": "안녕하세요, 시간 내주셔서 감사해요. 음성이 필요한 어떤 걸 만들고 계세요?",
    "ar": "أهلاً، شكراً لانضمامك. ما الذي تبنيه ويحتاج إلى الصوت؟",
    "ru": "Привет, спасибо, что подключились. Что вы создаёте, где нужен голос?",
    "pt": "Oi, obrigado por entrar. O que você está construindo que precisa de voz?",
}

# Strong refs to fire-and-forget side-call tasks so the loop doesn't GC them.
_BG_TASKS: set[asyncio.Task[None]] = set()


class LeadQualSettings(BaseAgentSettings):
    """Env-driven settings for the lead-qualification worker.

    Provider keys (``FISH_API_KEY`` / ``OPENROUTER_API_KEY`` / ``DEEPGRAM_API_KEY``)
    are read by voice-agent-core's provider settings. We add only the Fish voice id
    and the qualification side-call knobs.
    """

    # Single multilingual Fish voice id used for every language (s2.1-pro).
    fish_voice_id: str = Field(default="", description="Fish multilingual voice id (FISH_VOICE_ID)")
    # Cheap/fast model for the extraction side-call (OpenRouter notation).
    extraction_model: str = Field(
        default="openai/gpt-4.1-mini",
        description="Cheap LLM for qualification extraction (EXTRACTION_MODEL)",
    )
    extraction_max_tokens: int = Field(default=300, ge=32)
    greeting_mode: Literal["say", "generate", "none"] = "say"

    # Defaults tuned for the lead-qual demo (overridable via env).
    # s2.1-pro = Fish's expressive model (emotion markers); PCM output is hardcoded in
    # voice-agent-core which avoids the first-word crackle. Listen-test before changing.
    tts_model: str = "s2.1-pro"
    stt_model: str = ""  # "" -> Deepgram nova-3 default


load_env_walking_up(start=Path(__file__).parent)
settings = LeadQualSettings()
setup_observability(settings, service_name="lead-qual-worker")

# Register the multilingual turn-detector inference runner early (local dev mode),
# mirroring the smoke-agent template.
if settings.turn_detection_mode == "multilingual":
    from livekit.plugins.turn_detector.multilingual import (
        MultilingualModel as _MultilingualModel,  # noqa: F401
    )

server = AgentServer()
server.setup_fnc = default_prewarm


def _load_prompt(name: str) -> str:
    """Load a prompt file from ``prompts/`` at runtime; "" if missing."""
    path = PROMPTS_DIR / name
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        log.warning("prompt.load_failed", file=str(path), error=repr(exc))
        return ""


class LeadQualAgent(Agent):
    """The lead-qualification voice agent.

    Instructions = persona (``system_prompt.md``) + private rubric
    (``runbook.md``) + voice-output discipline + a per-session "respond in
    <language>" line. The runbook is injected as *private guidance* the agent
    never reads aloud.
    """

    def __init__(self, *, language_name: str) -> None:
        system_prompt = _load_prompt("system_prompt.md") or (
            "You are Fish, a warm voice agent running a quick discovery call."
        )
        runbook = _load_prompt("runbook.md")

        parts = [VOICE_OUTPUT_RULES, system_prompt]
        if runbook:
            parts.append(
                "PRIVATE RUBRIC (guidance only — never read aloud, never mention):\n"
                + runbook
            )
        parts.append(
            f"LANGUAGE: conduct the ENTIRE conversation in {language_name}. "
            f"Stay natural and idiomatic in {language_name}."
        )
        super().__init__(instructions="\n\n".join(parts))


def _language_from_metadata(raw_metadata: str | None) -> str:
    """Extract the ``language`` code from dispatch metadata. Defaults to ``en``.

    Metadata is ``{"language": "<code>"}`` per CONTRACT.md. Invalid / absent /
    non-object metadata falls back to the default (resolve handles unknown codes).
    """
    if not raw_metadata:
        return "en"
    try:
        payload = json.loads(raw_metadata)
    except (json.JSONDecodeError, TypeError):
        log.warning("metadata.invalid_json", raw=raw_metadata[:200])
        return "en"
    if not isinstance(payload, dict):
        return "en"
    code = payload.get("language")
    return code if isinstance(code, str) else "en"


def _session_settings(language) -> LeadQualSettings:
    """Per-session settings copy with STT language + Fish voice resolved."""
    return settings.model_copy(
        update={
            "stt_language": language.deepgram_language,
            "tts_voice": settings.fish_voice_id,
        }
    )


# gpt-5 / o-series take reasoning_effort="none" for low-latency, non-reasoning
# replies (chat-class models don't take the param at all).
_REASONING_MODEL_PREFIXES = ("openai/gpt-5", "gpt-5", "openai/o1", "o1", "o3", "o4")


def _maybe_disable_reasoning(pipeline: Any, cfg: LeadQualSettings) -> None:
    """Swap the conversation LLM for one with reasoning_effort='none'.

    voice-agent-core's ``build_openrouter_llm`` doesn't expose reasoning_effort,
    so for gpt-5/o-series models we rebuild the OpenRouter LLM here (a cheap,
    stateless construction) and replace ``pipeline.llm`` before the session is
    built. Non-reasoning chat models are left untouched. Best-effort: any failure
    falls back to the library-built LLM.
    """
    if cfg.llm_provider != "openrouter":
        return
    model = cfg.llm_model
    if not model.startswith(_REASONING_MODEL_PREFIXES):
        return
    api_key = OpenRouterSettings().api_key
    if not api_key:
        return
    try:
        from livekit.plugins import openai

        pipeline.llm = openai.LLM.with_openrouter(
            model=model,
            api_key=api_key,
            app_name="lead-qual-worker",
            reasoning_effort="none",
        )
        log.info("llm.reasoning_disabled", model=model)
    except Exception as exc:
        log.warning("llm.reasoning_override_failed", error=repr(exc))


def _spawn(coro) -> None:
    """Schedule a fire-and-forget task with a strong ref so it isn't GC'd."""
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


@server.rtc_session(agent_name=AGENT_NAME)
async def entry(ctx: JobContext) -> None:
    if is_warmup_session(ctx):
        log.info("session.warmup", room=ctx.room.name)
        return

    language = resolve_language(_language_from_metadata(ctx.job.metadata))
    log.info(
        "session.starting",
        room=ctx.room.name,
        language=language.code,
        stt_language=language.deepgram_language,
        supported=supported_languages(),
    )

    session_settings = _session_settings(language)
    if not session_settings.fish_voice_id:
        log.warning("config.fish_voice_id_missing", hint="set FISH_VOICE_ID in .env")

    try:
        pipeline = build_pipeline(session_settings, vad=ctx.proc.userdata["vad"])
    except Exception as exc:
        log.warning("pipeline.build_failed", room=ctx.room.name, error=repr(exc))
        return
    _maybe_disable_reasoning(pipeline, session_settings)
    session = build_session(pipeline)
    session_start = time.monotonic()

    # --- Qualification side-call wiring -------------------------------------
    publisher: QualificationPublisher | None = None
    openrouter_key = OpenRouterSettings().api_key
    if openrouter_key:
        extractor = QualificationExtractor(
            client=build_extraction_client(api_key=openrouter_key),
            model=session_settings.extraction_model,
            prompt_template=_load_prompt("extraction_prompt.md"),
            max_tokens=session_settings.extraction_max_tokens,
        )
        publisher = QualificationPublisher(room=ctx.room, extractor=extractor)
    else:
        log.warning("qualification.disabled", reason="OPENROUTER_API_KEY missing")

    def _on_item_added(ev: Any) -> None:
        """Fire the extraction side-call on each completed user turn."""
        if publisher is None:
            return
        item = getattr(ev, "item", None)
        if getattr(item, "role", None) != "user":
            return
        # Snapshot the transcript-so-far now (history already includes this item).
        transcript = format_transcript(session.history)
        if not transcript.strip():
            return
        _spawn(publisher.handle_turn(transcript))

    session.on("conversation_item_added", _on_item_added)

    def _on_close(_ev: Any) -> None:
        duration_s = round(time.monotonic() - session_start, 1)
        log.info("session.closed", room=ctx.room.name, duration_s=duration_s)

    session.on("close", _on_close)

    # Guarantee the final qualification snapshot is awaited before the job exits —
    # a close-event spawn can be GC'd / dropped as the process tears down.
    if publisher is not None:
        ctx.add_shutdown_callback(publisher.emit_final)

    await session.start(
        agent=LeadQualAgent(language_name=language.name),
        room=ctx.room,
        room_options=default_room_options(),
    )
    await ctx.connect()

    # Opener: a canned localized line (TTS-only, no LLM round-trip on turn 0) for
    # the snappiest first utterance.
    if session_settings.greeting_mode == "say":
        opener = _OPENERS.get(language.code, _OPENERS["en"])
        await session.say(opener)
    elif session_settings.greeting_mode == "generate":
        await session.generate_reply(
            instructions=(
                f"Greet the user warmly in {language.name} and ask what they're "
                "building that needs voice. One short sentence."
            )
        )


if __name__ == "__main__":
    cli.run_app(server)
