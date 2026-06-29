# Worker ↔ Web contract

The single interface both halves must agree on.

## Dispatch

- **`agent_name`**: `lead-qual` — the worker registers with it; the web dispatches it. Must match.
- **Dispatch metadata** (web → worker, JSON string) — the worker owns the persona, so the
  web passes only session options:
  ```json
  { "language": "en" }
  ```
  `language` ∈ `en, zh, de, ja, fr, es, ko, ar, ru, pt` (UI dropdown). Default `en`.
- **Warm-up**: the web may dispatch into a room named **`warmup-<id>`** to wake a cold
  worker before the user clicks Start. The worker short-circuits these (no pipeline, no
  cost). See `is_warmup_session`.

## Qualification data  (worker → web, LiveKit data channel, `topic:"qualification"`)

Emitted after each **user** turn (and a final one on session close):

```json
{
  "kind": "qualification",
  "seq": 3,
  "slots": {
    "use_case":         "Real-time support agent",
    "real_time":        "real-time",          // real-time | batch | both | null
    "volume":           "~300k min / mo",      // stated monthly volume
    "current_provider": "ElevenLabs",          // current stack / "none"
    "priority":         "latency",             // the ONE thing that matters most
    "timeline":         "Before Q3"
  },
  "signals": ["⚡ High volume", "Switching from 11Labs", "Privacy: zero-retention"],
  "path":    "cloud-enterprise",               // recommended routing (see below)
  "reason":  "real-time + high volume + switching",
  "next_question": "What peak concurrency are you planning for?"
}
```

- Any slot may be `null`. `seq` is **monotonically increasing** per call.
- **`path` / `reason` are owned by the worker reducer (side-call)** — the main agent only
  converses + routes verbally; it does **not** decide UI state and does **not** call a tool.

### `path` (recommended routing) — replaces the old score/verdict
| value | meaning | UI badge |
|---|---|---|
| `needs-more-info` | not enough signal yet | grey · pending |
| `self-serve` | early / low-volume / exploring → Developer Console | blue |
| `cloud-enterprise` | production scale / concurrency / privacy / near-term → enterprise follow-up | green · strong lead |
| `on-prem` | explicit on-prem / VPC / self-host requirement | purple · strong lead |

A `cloud-enterprise` or `on-prem` path is the "qualified" moment → trigger the celebration.

### Worker reducer rules (canonical state per call)
- **slots**: merge **non-null only** — never revert a known slot back to `null`.
- **signals**: union, dedupe, keep first-seen order.
- **path**: take the side-call's latest non-`needs-more-info` value; once it reaches
  `cloud-enterprise`/`on-prem`, don't downgrade to `self-serve`/`needs-more-info`
  (monotonic toward "more qualified"). `reason`/`next_question`: latest non-empty.
- Emit the **merged snapshot** (full state), `seq += 1`. Side-call is fire-and-forget;
  errors swallowed so it never breaks the call.

### Web rules
- Keep `lastSeq`. Route to scorecard if **`topic==="qualification"` OR `kind==="qualification"`**.
  **Ignore `seq <= lastSeq`**. Ignore packets after the call ended.
- Render the 6 slots (fill when non-null), `signals` as badges, the `path` routing badge,
  and `reason`. Celebrate when `path` ∈ {`cloud-enterprise`, `on-prem`}.
- **Strip emotion cues** from transcript text before display — the agent emits free-form
  bracket cues like `[warm]`, `[thoughtful, slightly amused]`, `[break]`. Strip any
  leading/inline `[...]` of reasonable length (not just short ones):
  `text.replace(/\[[^\]\n]{0,40}\]/g, "")` then trim.

## Prompts
Persona + full Fish domain knowledge live in `prompts/system_prompt.md` (an unnamed
Fish Audio sales engineer — no persona name). The
private routing rubric is in `prompts/runbook.md`. The side-call schema + rubric are in
`prompts/extraction_prompt.md`. These are tuned with real call data.
