"""Language mapping for the lead-qualification worker.

The web passes a single ISO-ish ``language`` code in dispatch metadata (see
CONTRACT.md). This module is the *one* place that maps that code to:

- the **Deepgram STT language hint** (``stt_language``),
- a human-readable **language name** used to append a "respond in <language>"
  line to the agent instructions, and
- a **Fish locale tag** (informational — a single multilingual Fish voice is
  used via ``FISH_VOICE_ID``, so the locale doesn't switch the voice; it's kept
  for logging / future per-locale voice selection).

Adding a language is a one-line table entry — by design. Fish s2.1-pro is a
multilingual model and a single multilingual voice id (``FISH_VOICE_ID``) covers
all of these, so there's no per-language voice plumbing to add.

Deepgram note: Nova-3 takes either a specific language code (``en``, ``de``, …)
or ``multi`` for code-switching. We pass the specific code when Deepgram supports
it; for languages without dedicated streaming support we fall back to ``multi``
so the demo still transcribes (see ``_DEEPGRAM_MULTI``).
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_LANGUAGE = "en"

# Languages where we prefer Deepgram's multilingual/code-switching model rather
# than a dedicated per-language streaming model. Keeping this explicit makes the
# tradeoff visible and easy to revisit per language.
_DEEPGRAM_MULTI = "multi"


@dataclass(frozen=True)
class LanguageProfile:
    """Resolved language settings for one ISO code."""

    code: str
    name: str  # human-readable, used in the "respond in <name>" instruction
    deepgram_language: str  # value passed to Deepgram STT
    fish_locale: str  # informational locale tag (single multilingual voice used)


# The mapping table. To add a language, add one row. The ~10 Fish-supported
# languages requested by the contract are all present.
_PROFILES: dict[str, LanguageProfile] = {
    "en": LanguageProfile("en", "English", "en", "en-US"),
    "zh": LanguageProfile("zh", "Chinese", "zh", "zh-CN"),
    "de": LanguageProfile("de", "German", "de", "de-DE"),
    "ja": LanguageProfile("ja", "Japanese", "ja", "ja-JP"),
    "fr": LanguageProfile("fr", "French", "fr", "fr-FR"),
    "es": LanguageProfile("es", "Spanish", "es", "es-ES"),
    "ko": LanguageProfile("ko", "Korean", "ko", "ko-KR"),
    # Arabic + Russian: Deepgram Nova-3 streaming coverage is uneven, so route
    # through the multilingual model to stay robust for the demo.
    "ar": LanguageProfile("ar", "Arabic", _DEEPGRAM_MULTI, "ar-SA"),
    "ru": LanguageProfile("ru", "Russian", "ru", "ru-RU"),
    "pt": LanguageProfile("pt", "Portuguese", "pt", "pt-PT"),
}


def resolve_language(code: str | None) -> LanguageProfile:
    """Resolve a dispatch ``language`` code to a :class:`LanguageProfile`.

    Falls back to :data:`DEFAULT_LANGUAGE` (``en``) for absent / unknown codes,
    per CONTRACT.md. Matching is case-insensitive and tolerates region suffixes
    like ``en-US`` or ``zh_CN`` by taking the leading subtag.
    """
    if not code:
        return _PROFILES[DEFAULT_LANGUAGE]
    base = code.strip().lower().replace("_", "-").split("-", 1)[0]
    return _PROFILES.get(base, _PROFILES[DEFAULT_LANGUAGE])


def supported_languages() -> list[str]:
    """Return the list of supported ISO codes (for logging / UI parity)."""
    return list(_PROFILES)


__all__ = [
    "DEFAULT_LANGUAGE",
    "LanguageProfile",
    "resolve_language",
    "supported_languages",
]
