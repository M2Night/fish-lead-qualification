import { NextResponse } from 'next/server';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';

// Must match the worker's registered agent_name (see agent-demo-core agents/lead_qual).
const AGENT_NAME = 'lead-qual';
const SUPPORTED_LANGUAGES = new Set(['en', 'zh', 'ja']);
const SUPPORTED_VOICES = new Set(['koi', 'finn', 'marlin']);
const MAX_BODY_BYTES = 4096; // room_config is tiny; reject anything larger
const MAX_METADATA_CHARS = 1024;

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export const revalidate = 0;

// SECURITY: this endpoint is unauthenticated and un-rate-limited — an accepted risk for this
// open demo (document/gate it before any non-demo use). Crucially, the client's `room_config`
// is UNTRUSTED: we read ONLY its `{ language, voice }` agent metadata, validate it, and rebuild
// the agent dispatch SERVER-SIDE with a HARDCODED agent name. That stops a client from
// dispatching a different agent or tampering with room config (max_participants, etc.).
export async function POST(req: Request) {
  try {
    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set.');
    }

    // Reject oversized bodies before parsing — we only need a tiny room_config.
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return new NextResponse('Payload too large', { status: 413 });
    }

    const body = await req.json().catch(() => ({}));
    const client = readClientMetadata(body?.room_config);
    const language = SUPPORTED_LANGUAGES.has(client.language ?? '') ? client.language! : 'en';
    const voice = SUPPORTED_VOICES.has(client.voice ?? '') ? client.voice : undefined;
    const metadata = JSON.stringify({
      language,
      ...(voice ? { voice } : {}),
    });

    const roomName = `lead-qual-room-${randomUUID().slice(0, 8)}`;
    const participantName = 'user';
    const participantIdentity = `lead-qual-user-${randomUUID().slice(0, 8)}`;

    const at = new AccessToken(API_KEY, API_SECRET, {
      identity: participantIdentity,
      name: participantName,
      ttl: '15m',
    });
    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // no canPublishData: conversation-only, the client publishes no data
    };
    at.addGrant(grant);
    // Server-built dispatch — agentName is hardcoded here, never taken from the client.
    at.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata })],
    });

    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName,
      participantToken: await at.toJwt(),
    };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/token]', message);
    // Don't echo internals to the client — log server-side, return a generic message.
    return new NextResponse('Failed to mint token', { status: 500 });
  }
}

// Extract the (untrusted) agent metadata the client put in room_config.agents[0].metadata.
// We read the metadata string directly (no protobuf parse of untrusted input), cap its
// size, and JSON.parse only that string — then use language/voice; everything else is
// discarded. Any malformed/oversized input falls back to {}.
function readClientMetadata(roomConfigJson: unknown): {
  language?: string;
  voice?: string;
} {
  try {
    const raw = (roomConfigJson as { agents?: Array<{ metadata?: unknown }> })?.agents?.[0]
      ?.metadata;
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_METADATA_CHARS) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as { language?: string; voice?: string })
      : {};
  } catch {
    return {};
  }
}
