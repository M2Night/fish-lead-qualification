"""Lead-qualification extraction + reducer + data-channel emit.

Implements the worker side of the qualification contract (see CONTRACT.md):

On each **user** turn the agent fires a *fire-and-forget* side-call:

1. Build a transcript-so-far and ask a cheap/fast LLM (JSON mode) to extract
   the structured snapshot per ``extraction_prompt.md`` (6 slots + signals[] +
   path + reason + next_question).
2. Feed that raw extraction into :class:`QualificationReducer`, which holds the
   canonical state for the call and applies the contract's reducer rules
   (merge non-null slots, union signals, monotonic ``path`` toward "more
   qualified", latest non-empty reason/next_question).
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

# Canonical slot keys per CONTRACT.md (the web adapter maps use_case->useCase,
# real_time->realTime, current_provider->currentProvider, etc.).
SLOT_KEYS = (
    "use_case",
    "real_time",
    "volume",
    "current_provider",
    "priority",
    "timeline",
)

# Recommended routing path (CONTRACT.md). Ordered by "more qualified":
# needs-more-info < self-serve < {cloud-enterprise, on-prem}. cloud-enterprise
# and on-prem are both "strong" (rank 2) — flips between them take the latest.
PATH_NEEDS_MORE_INFO = "needs-more-info"
PATH_SELF_SERVE = "self-serve"
PATH_CLOUD_ENTERPRISE = "cloud-enterprise"
PATH_ON_PREM = "on-prem"
_PATH_RANK: dict[str, int] = {
    PATH_NEEDS_MORE_INFO: 0,
    PATH_SELF_SERVE: 1,
    PATH_CLOUD_ENTERPRISE: 2,
    PATH_ON_PREM: 2,
}

_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass
class QualificationState:
    """Canonical, monotonically-evolving qualification state for one call."""

    seq: int = 0
    slots: dict[str, str | None] = field(
        default_factory=lambda: dict.fromkeys(SLOT_KEYS)
    )
    signals: list[str] = field(default_factory=list)
    path: str = PATH_NEEDS_MORE_INFO
    reason: str = ""
    next_question: str | None = None

    def snapshot(self) -> dict[str, Any]:
        """Render the full merged snapshot for the data channel."""
        return {
            "kind": "qualification",
            "seq": self.seq,
            "slots": dict(self.slots),
            "signals": list(self.signals),
            "path": self.path,
            "reason": self.reason,
            "next_question": self.next_question,
        }


def _normalize_path(value: Any) -> str | None:
    """Return a known ``path`` value, or ``None`` if unrecognized/empty."""
    if not value:
        return None
    text = str(value).strip().lower()
    return text if text in _PATH_RANK else None


class QualificationReducer:
    """Holds canonical call state and merges raw extraction snapshots into it.

    Reducer rules (CONTRACT.md):

    - **slots**: merge non-null only — a known slot is never reverted to null.
    - **signals**: union, dedupe, keep first-seen order.
    - **path**: monotonic toward "more qualified". The side-call's latest
      ``path`` is adopted only when it does not *downgrade* the current rank
      (``needs-more-info`` < ``self-serve`` < {``cloud-enterprise``,
      ``on-prem``}). Equal-rank moves take the latest (so the two "strong"
      paths can flip between each other); a ``needs-more-info`` from the
      side-call is never adopted once any stronger path is set.
    - **reason / next_question**: latest non-empty.
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

        # path: monotonic toward "more qualified" (no downgrade).
        st.path = self._reduce_path(delta.get("path"))

        # reason / next_question: take latest non-empty (advisory fields).
        reason = delta.get("reason")
        if reason not in (None, "") and str(reason).strip():
            st.reason = str(reason).strip()
        nq = delta.get("next_question")
        if nq not in (None, "") and str(nq).strip():
            st.next_question = str(nq).strip()

        return st

    def _reduce_path(self, raw_path: Any) -> str:
        """Apply monotonic path routing. Returns the new canonical path.

        Adopt the incoming path only when its rank is >= the current rank;
        otherwise keep the current path (never downgrade). Equal rank adopts
        the incoming value so the two "strong" paths flip to the latest. An
        unknown/empty incoming path keeps the current path.
        """
        current = self._state.path
        incoming = _normalize_path(raw_path)
        if incoming is None:
            return current
        if _PATH_RANK[incoming] >= _PATH_RANK[current]:
            return incoming
        return current


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

    One instance per session. ``handle_turn`` is meant to be scheduled
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
                path=state.path,
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
