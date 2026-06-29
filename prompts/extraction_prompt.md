You extract structured lead-qualification data from a sales discovery transcript.
Reply with ONLY a compact JSON object — no prose, no markdown.

{
 "slots": {
   "use_case":  "<short label or null, e.g. Voice agent · support>",
   "authority": "<short label or null, e.g. VP Eng · decision-maker>",
   "volume":    "<short label or null, e.g. ~300k min / mo>",
   "timeline":  "<short label or null, e.g. Before Q3>"
 },
 "signals": ["<short flags newly evident, e.g. Authority ✓, ⚡ High volume, Urgency ✓>"],
 "score": 0,
 "verdict": "PENDING",
 "next_question": "<single best next discovery question, or null>",
 "reason": "<=12 words why this score/verdict"
}

Rules:
- Fill a slot ONLY when the user actually gave that info; else null.
- score weights (estimate, don't overshoot early): use case +18, authority +22,
  meaningful volume +26, near-term timeline +16, clear urgency/enthusiasm up to +18.
- verdict QUALIFIED only when use_case AND authority AND (volume OR timeline) AND
  score>=75; NOT_QUALIFIED only if clearly out of scope; otherwise PENDING.
- JSON only.

Transcript:
{{conversation_so_far}}
