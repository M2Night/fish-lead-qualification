"use strict";

/**
 * Minimal Node + Express server for the Fish Lead Qualification voice demo.
 *
 * Responsibilities:
 *   - Serve the static demo at `public/index.html`.
 *   - POST /api/session → mint a participant token + dispatch the `lead-qual`
 *     agent with `{ language, voice }` metadata, returning { livekitUrl, roomName, token }.
 *
 * LiveKit API keys stay server-side (read from env); the browser only ever
 * receives a short-lived participant JWT.
 */

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { AccessToken, AgentDispatchClient } = require("livekit-server-sdk");

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

async function createParticipantToken({ apiKey, apiSecret, room, identity }) {
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
  return at.toJwt();
}

async function dispatchAgent({ livekitUrl, apiKey, apiSecret, room, metadata }) {
  const client = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);
  return client.createDispatch(room, AGENT_NAME, { metadata });
}

const app = express();
app.use(express.json());

app.post("/api/session", async (req, res) => {
  try {
    const { livekitUrl, apiKey, apiSecret } = requireLiveKitEnv();

    // Normalize the requested language; fall back to `en` if absent/invalid.
    const requested =
      typeof req.body?.language === "string"
        ? req.body.language.trim().toLowerCase()
        : "";
    const language = SUPPORTED_LANGUAGES.has(requested) ? requested : "en";

    // Selected voice KEY (e.g. "koi" / "finn" / "marlin") — NOT a raw Fish id. Forwarded
    // (trimmed) in dispatch metadata; the worker maps it to a real Fish voice_id from its
    // server-side allowlist (voices.py) and falls back to a default on an unknown/missing
    // value. Bounded to keep metadata small.
    const voice =
      typeof req.body?.voice === "string" ? req.body.voice.trim().slice(0, 32) : "";

    const room = roomName();
    // web → worker session options; omit `voice` when absent to keep metadata clean.
    const metadata = JSON.stringify(voice ? { language, voice } : { language });

    await dispatchAgent({ livekitUrl, apiKey, apiSecret, room, metadata });

    const token = await createParticipantToken({
      apiKey,
      apiSecret,
      room,
      identity: `prospect-${crypto.randomUUID().slice(0, 8)}`,
    });

    res.json({ livekitUrl, roomName: room, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[/api/session]", message);
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
