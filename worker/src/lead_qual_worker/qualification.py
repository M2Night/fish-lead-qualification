"""Lead-qualification extraction + reducer + data-channel emit.

Implements the worker side of the qualification contract (see CONTRACT.md):

On each **user** turn the agent fires a *fire-and-forget* side-call:

1. Build a transcript-so-far and ask a cheap/fast LLM (JSON mode) to extract
   the structured delta per ``extraction_prompt.md``.
2. Feed that raw delta into :class:`QualificationReducer`, which holds the
   canonical state for the call and applies the contract's reducer rules
   (merge non-null slots, union signals, monotonic score, verdict logic).
3. Publish the **merged snapshot** (full state, monotonic ``seq``) on the
   LiveKit data channel with ``topic="qualification"``.

The side-call is best-effort: any error (LLM failure, bad JSON, publish error)
is logged and swallowed so it can never break the live conversation. A final
snapshot is emitted on session close.

The extractor uses an independent OpenAI-compatible client pointed at OpenRouter
(``EXTRACTION_MODEL``, default a cheap model) so JSON mode + a small token budget
are trivial to set and the side-call never contends with the conversation LLM.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from voice_agent_core import get_logger

if TYPE_CHECKING:
    from openai import AsyncOpenAI

log = get_logger(__name__)

# Canonical slot keys per CONTRACT.md (web adapter maps use_case->useCase, etc.).
SLOT_KEYS = ("use_case", "authority", "volume", "timeline")
_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass
class QualificationState:
    """Canonical, monotonically-evolving qualification state for one call."""

    seq: int = 0
    slots: dict[str, str | None] = field(
        default_factory=lambda: dict.fromkeys(SLOT_KEYS)
    )
    signals: list[str] = field(default_factory=list)
    score: int = 0
    verdict: str = "PENDING"
    next_question: str | None = None
    reason: str = ""

    def snapshot(self) -> dict[str, Any]:
        """Render the full merged snapshot for the data channel."""
        return {
            "kind": "qualification",
            "seq": self.seq,
            "slots": dict(self.slots),
            "signals": list(self.signals),
            "score": self.score,
            "verdict": self.verdict,
            "next_question": self.next_question,
            "reason": self.reason,
        }


def _clamp_score(value: Any) -> int:
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        return 0


class QualificationReducer:
    """Holds canonical call state and merges raw extraction deltas into it.

    Reducer rules (CONTRACT.md):

    - **slots**: merge non-null only — a known slot is never reverted to null.
    - **signals**: union, dedupe, keep first-seen order.
    - **score**: ``max(old, clamp(new, 0, 100))`` — monotonic, never drops.
    - **verdict**: ``QUALIFIED`` if the side-call says so, or if
      ``score >= 75 && use_case && authority && (volume || timeline)``;
      ``NOT_QUALIFIED`` only when explicitly returned (and then it sticks);
      else ``PENDING``.
    """

    def __init__(self) -> None:
        self._state = QualificationState()

    @property
    def state(self) -> QualificationState:
        return self._state

    def reduce(self, delta: dict[str, Any]) -> QualificationState:
        """Merge one raw extraction ``delta`` and bump ``seq``. Returns state."""
        st = self._state
        st.seq += 1

        # slots: merge non-null only.
        raw_slots = delta.get("slots") or {}
        if isinstance(raw_slots, dict):
            for key in SLOT_KEYS:
                value = raw_slots.get(key)
                if value is not None and str(value).strip():
                    st.slots[key] = str(value).strip()

        # signals: union, dedupe, preserve first-seen order.
        raw_signals = delta.get("signals") or []
        if isinstance(raw_signals, list):
            existing = set(st.signals)
            for sig in raw_signals:
                text = str(sig).strip()
                if text and text not in existing:
                    st.signals.append(text)
                    existing.add(text)

        # score: monotonic max.
        st.score = max(st.score, _clamp_score(delta.get("score")))

        # next_question / reason: take latest non-empty (purely advisory fields).
        nq = delta.get("next_question")
        st.next_question = str(nq).strip() if nq not in (None, "") else st.next_question
        reason = delta.get("reason")
        if reason not in (None, ""):
            st.reason = str(reason).strip()

        st.verdict = self._resolve_verdict(delta.get("verdict"))
        return st

    def _resolve_verdict(self, raw_verdict: Any) -> str:
        st = self._state
        incoming = str(raw_verdict).strip().upper() if raw_verdict else ""

        # NOT_QUALIFIED only if explicit, and once set it sticks.
        if st.verdict == "NOT_QUALIFIED":
            return "NOT_QUALIFIED"
        if incoming == "NOT_QUALIFIED":
            return "NOT_QUALIFIED"

        rule_qualified = (
            st.score >= 75
            and bool(st.slots["use_case"])
            and bool(st.slots["authority"])
            and bool(st.slots["volume"] or st.slots["timeline"])
        )
        if incoming == "QUALIFIED" or rule_qualified:
            return "QUALIFIED"
        return "PENDING"


class QualificationExtractor:
    """Runs the JSON-mode extraction side-call against a cheap LLM."""

    def __init__(
        self,
        *,
        client: AsyncOpenAI,
        model: str,
        prompt_template: str,
        max_tokens: int = 300,
    ) -> None:
        self._client = client
        self._model = model
        self._prompt_template = prompt_template
        self._max_tokens = max_tokens

    async def extract(self, transcript: str) -> dict[str, Any] | None:
        """Return the raw extraction dict, or ``None`` on any failure.

        Errors are swallowed (logged at warning) so the live call is never
        affected by a flaky / slow side-call.
        """
        if "{{conversation_so_far}}" in self._prompt_template:
            prompt = self._prompt_template.replace("{{conversation_so_far}}", transcript)
        else:
            prompt = f"{self._prompt_template}\n\nTranscript:\n{transcript}"
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=self._max_tokens,
                temperature=0,
            )
            content = resp.choices[0].message.content or "{}"
            data = json.loads(content)
        except Exception as exc:
            log.warning("qualification.extract_failed", error=repr(exc))
            return None
        if not isinstance(data, dict):
            log.warning("qualification.extract_bad_shape", got=type(data).__name__)
            return None
        return data


def build_extraction_client(*, api_key: str) -> AsyncOpenAI:
    """Build the OpenRouter-backed OpenAI-compatible client for extraction."""
    from openai import AsyncOpenAI

    return AsyncOpenAI(base_url=_OPENROUTER_BASE_URL, api_key=api_key)


class QualificationPublisher:
    """Glues extractor + reducer + LiveKit data-channel publish together.

    One instance per session. ``handle_user_turn`` is meant to be scheduled
    fire-and-forget (``asyncio.create_task``) from the ``conversation_item_added``
    hook; the caller owns the strong reference to the task.
    """

    def __init__(
        self,
        *,
        room: Any,
        extractor: QualificationExtractor,
    ) -> None:
        self._room = room
        self._extractor = extractor
        self._reducer = QualificationReducer()
        # Serialize emits so out-of-order side-calls can't publish a stale seq.
        self._lock = asyncio.Lock()

    async def handle_turn(self, transcript: str) -> None:
        """Extract → reduce → publish for one user turn. Best-effort."""
        delta = await self._extractor.extract(transcript)
        if delta is None:
            return
        async with self._lock:
            state = self._reducer.reduce(delta)
            await self._publish(state)

    async def emit_final(self) -> None:
        """Publish the current canonical state once more (session close)."""
        async with self._lock:
            state = self._reducer.state
            state.seq += 1
            await self._publish(state)

    async def _publish(self, state: QualificationState) -> None:
        payload = json.dumps(state.snapshot())
        try:
            await self._room.local_participant.publish_data(
                payload,
                reliable=True,
                topic="qualification",
            )
            log.info(
                "qualification.published",
                seq=state.seq,
                score=state.score,
                verdict=state.verdict,
            )
        except Exception as exc:
            log.warning("qualification.publish_failed", error=repr(exc))


__all__ = [
    "SLOT_KEYS",
    "QualificationExtractor",
    "QualificationPublisher",
    "QualificationReducer",
    "QualificationState",
    "build_extraction_client",
]
