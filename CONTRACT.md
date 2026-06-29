# Worker ↔ Web contract

The single interface both halves must agree on.

## Dispatch

- **`agent_name`**: `lead-qual` — the worker registers with it; the web dispatches it. Must match.
- **Dispatch metadata** (web → worker, JSON string): the worker owns the persona, so the
  web only passes session options:
  ```json
  { "language": "en" }
  ```
  `language` is an ISO-ish code from the UI dropdown (`en`, `zh`, `de`, `ja`, `fr`, `es`,
  `ko`, `ar`, `ru`, `pt`, …). The worker maps it to STT language + Fish voice/locale + a
  "respond in this language" instruction. Default `en` if absent/invalid.

## Qualification data  (worker → web, LiveKit data channel, `topic:"qualification"`)

Emitted after each **user** turn (and a final one on session close):

```json
{
  "kind": "qualification",
  "seq": 3,
  "slots": {
    "use_case":  "Voice agent · support",
    "authority": "VP Eng · decision-maker",
    "volume":    "~300k min / mo",
    "timeline":  "Before Q3"
  },
  "signals": ["Authority ✓", "⚡ High volume", "Urgency ✓"],
  "score": 66,
  "verdict": "PENDING",
  "next_question": "What's pushing you to move now?",
  "reason": "authority + high volume, timeline TBD"
}
```

- Any slot may be `null`. `seq` is **monotonically increasing** per call.
- **score / verdict are owned by the worker's reducer (side-call)** — the main agent never
  decides UI state, it only converses.

### Worker reducer rules (canonical state per call)
- **slots**: merge **non-null only** — never revert a known slot back to `null`.
- **signals**: union, dedupe, keep first-seen order.
- **score**: `max(old, clamp(new,0,100))` — **monotonic**, no drops on low-confidence turns.
- **verdict**: `QUALIFIED` if side-call says so, or `score>=75 && use_case && authority &&
  (volume || timeline)`; else `PENDING`. (`NOT_QUALIFIED` only if explicit and it sticks.)
- Emit the **merged snapshot** (full state), not the raw delta. Side-call is
  fire-and-forget; errors swallowed so it never breaks the call.

### Web rules
- Keep `lastSeq`. Route to scorecard if **`topic==="qualification"` OR parsed
  `kind==="qualification"`** (dual guard). **Ignore `seq <= lastSeq`** (no backwards moves).
- Field adapter → existing UI keys: `use_case→useCase`, `authority→role`, `volume`, `timeline`.
- **Strip emotion markers** from transcript text before display, e.g.
  `text.replace(/\s*[\[(][a-z][a-z ,'’-]{0,22}[\])]/gi, "")`, so `(warm)` / `[whisper]`
  never show as text.

## Prompts

The agent's persona lives in `prompts/system_prompt.md`, private rubric in
`prompts/runbook.md`, and the extraction prompt in `prompts/extraction_prompt.md`.
These are placeholders to be optimized with real call data.
