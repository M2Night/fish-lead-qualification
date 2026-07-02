"use strict";

/**
 * Minimal Node + Express server for the Fish Lead Qualification voice demo.
 *
 * Responsibilities:
 *   - Serve the static demo at `public/index.html`.
 *   - POST /api/session → mint a participant token whose LiveKit RoomConfiguration
 *     AUTO-DISPATCHES the `lead-qual` agent (with `{ language, voice, trace }` metadata)
 *     when the room is created. Returns { livekitUrl, roomName, token, trace, timing }.
 *
 * The agent dispatch rides in the token (no separate AgentDispatchClient call) — the
 * official pattern used by the sibling Fish demos. LiveKit API keys stay server-side;
 * the browser only ever receives a short-lived participant JWT.
 */

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const {
  AccessToken,
  RoomConfiguration,
  RoomAgentDispatch,
} = require("livekit-server-sdk");

const AGENT_NAME = "lead-qual"; // must match the worker's registered agent_name (CONTRACT.md)
const PORT = Number(process.env.PORT) || 3000;

// Languages the UI offers (per CONTRACT.md); default `en`.
const SUPPORTED_LANGUAGES = new Set(["en", "zh", "ja"]);

function requireLiveKitEnv() {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required (see .env.example).",
    );
  }
  return { livekitUrl, apiKey, apiSecret };
}

function roomName() {
  return `lead-qual-${crypto.randomUUID().slice(0, 8)}`;
}

// Mint a participant token that ALSO auto-dispatches the lead-qual agent (with metadata)
// via RoomConfiguration — LiveKit spawns the agent when the room is created on connect.
async function createParticipantToken({ apiKey, apiSecret, room, identity, metadata }) {
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: "Prospect",
    ttl: "30m",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true, // publish mic audio
    canSubscribe: true, // hear the agent
    // no canPublishData: the client sends no data (conversation-only, no data channel)
  });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata })],
  });
  return at.toJwt();
}

const app = express();
app.use(express.json());

app.post("/api/session", async (req, res) => {
  const t0 = Date.now();
  // Trace id to stitch browser → server → worker timings. Reuse the client's if given.
  const trace =
    typeof req.body?.trace === "string" && req.body.trace.trim()
      ? req.body.trace.trim().slice(0, 64)
      : crypto.randomUUID().slice(0, 8);
  try {
    const { livekitUrl, apiKey, apiSecret } = requireLiveKitEnv();

    // Normalize the requested language; fall back to `en` if absent/invalid.
    const requested =
      typeof req.body?.language === "string"
        ? req.body.language.trim().toLowerCase()
        : "";
    const language = SUPPORTED_LANGUAGES.has(requested) ? requested : "en";

    // Selected voice KEY (e.g. "koi" / "finn" / "marlin") — NOT a raw Fish id. The worker
    // maps it to a real Fish voice_id from its server-side allowlist (voices.py) and falls
    // back to a default on an unknown/missing value. Bounded to keep metadata small.
    const voice =
      typeof req.body?.voice === "string" ? req.body.voice.trim().slice(0, 32) : "";

    const room = roomName();
    // web → worker session options (carried in the agent-dispatch metadata); omit `voice`
    // when absent to keep it clean.
    const metadata = JSON.stringify({ language, ...(voice ? { voice } : {}), trace });

    const tToken = Date.now();
    const token = await createParticipantToken({
      apiKey,
      apiSecret,
      room,
      identity: `prospect-${crypto.randomUUID().slice(0, 8)}`,
      metadata,
    });
    const token_ms = Date.now() - tToken;

    const total_ms = Date.now() - t0;
    console.log(
      `[/api/session] trace=${trace} lang=${language} voice=${voice || "-"} ` +
        `token_ms=${token_ms} total_ms=${total_ms} (auto-dispatch)`,
    );
    res.json({
      livekitUrl,
      roomName: room,
      token,
      trace,
      timing: { token_ms, total_ms },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[/api/session] trace=${trace}`, message);
    res.status(500).json({ error: message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

// Run a real HTTP listener only when invoked directly (local dev / a plain Node
// host). On Vercel this file is imported as a serverless function, so we export the
// Express app instead of calling listen() (see web/vercel.json).
if (require.main === module) {
  app.listen(PORT, () => {
    const haveKeys =
      process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET;
    console.log(`Fish Lead Qualification demo → http://localhost:${PORT}`);
    if (!haveKeys) {
      console.warn(
        "  ⚠  LIVEKIT_* env not set — the page will load but 'Start call' will 500 until you add keys (.env).",
      );
    }
  });
}

module.exports = app;
