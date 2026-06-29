"use strict";

/**
 * Minimal Node + Express server for the Fish Lead Qualification voice demo.
 *
 * Responsibilities:
 *   - Serve the static demo at `public/index.html`.
 *   - POST /api/session → mint a participant token + dispatch the `lead-qual`
 *     agent with `{ language }` metadata, returning { livekitUrl, roomName, token }.
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

// ISO-ish codes the worker understands; default `en` per CONTRACT.md.
const SUPPORTED_LANGUAGES = new Set([
  "en",
  "zh",
  "de",
  "ja",
  "fr",
  "es",
  "ko",
  "ar",
  "ru",
  "pt",
]);

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
    canPublishData: true,
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

    const room = roomName();
    const metadata = JSON.stringify({ language }); // web → worker session options

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

// Warm-up: dispatch the agent into a `warmup-<uuid>` room to wake a cold worker
// before the user clicks Start. No participant token — the dispatch alone wakes
// the worker, which short-circuits warmup rooms (CONTRACT.md). Never throws.
app.post("/api/warmup", async (req, res) => {
  try {
    const { livekitUrl, apiKey, apiSecret } = requireLiveKitEnv();
    const room = `warmup-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ language: "en" });
    await dispatchAgent({ livekitUrl, apiKey, apiSecret, room, metadata });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[/api/warmup]", message);
    res.json({ ok: false, error: message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

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
