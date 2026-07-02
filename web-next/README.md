# Fish Lead Qualification — frontend

The web half of the [Fish Lead Qualification voice demo](../README.md): a Next.js 15
app that mints LiveKit room tokens and renders the call UI — a landing page with a
**language + voice picker**, then a live voice-assistant view. It's built on
[`@livekit/components-react`](https://github.com/livekit/components-js) +
[`livekit-client`](https://github.com/livekit/client-sdk-js), bootstrapped from
[`agent-starter-react`](https://github.com/livekit-examples/agent-starter-react).

This directory is self-contained — you can run it on its own against any LiveKit
project that has the `lead-qual` worker (`agent-demo-core/agents/lead_qual/`, or any
compatible agent) connected to it.

## Run it standalone

You need a [LiveKit Cloud](https://cloud.livekit.io) project and the `lead-qual`
worker running against it (see
[`agent-demo-core/agents/lead_qual/README.md`](../../agent-demo-core/agents/lead_qual/README.md)).

```bash
cp .env.example .env.local   # then fill in your LiveKit credentials
pnpm install
pnpm dev                     # http://localhost:3000
```

### Docker

```bash
docker build -t lead-qual-web .
docker run --rm -p 3000:3000 --env-file .env.local lead-qual-web
```

The image is built from Next's standalone output (`output: 'standalone'` in
[`next.config.ts`](./next.config.ts)) so it ships just the server + traced
dependencies.

## Environment variables

Server-side only (used by the `/api/token` route to mint access tokens):

```env
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

The dispatched agent name is **hardcoded** to `lead-qual` in
[`app/api/token/route.ts`](./app/api/token/route.ts) (it must match the worker's
registered `agent_name`) — it is deliberately **not** configurable via env, so a
client can never dispatch a different agent.

## How dispatch works

The landing page collects a `{ language, voice }` choice and passes it as
`agentMetadata` on the `useSession` options. `@livekit/components-react` POSTs a
`room_config` to `/api/token`. The route treats that `room_config` as **untrusted**:
it reads only the `{ language, voice }` metadata, validates each against an allowlist
(`en`/`zh`/`ja`, `koi`/`finn`/`marlin`), and rebuilds the agent dispatch server-side
with the hardcoded `lead-qual` name before signing it into the JWT. The worker maps
the voice **key** to a real Fish `voice_id` from its own allowlist (`voices.py`).

> **The `/api/token` route is unauthenticated and un-rate-limited** — an accepted
> risk for this open demo. Gate it (auth and/or rate limit) before any non-demo use.

## Customizing

- Landing copy lives in [`components/app/welcome-view.tsx`](./components/app/welcome-view.tsx); the language + voice picker is in the same view.
- The voice list (`koi`/`finn`/`marlin`), languages (`en`/`zh`/`ja`), and the dispatched `agentName` default live in [`app-config.ts`](./app-config.ts).
- The live call UI (audio renderer, control bar, visualizer) is assembled in [`components/agents-ui/`](./components/agents-ui/).

For the full Agents UI component reference (updating components via
`pnpm shadcn:install`, etc.), see the upstream
[`agent-starter-react`](https://github.com/livekit-examples/agent-starter-react) README.
