'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import {
  useRoomContext,
  useSessionContext,
  useStartAudio,
  useVoiceAssistant,
} from '@livekit/components-react';
import { LANGUAGES, VOICES } from '@/app-config';
import { useWaveform } from '@/hooks/useWaveform';
import { type CallSounds, createCallSounds } from '@/lib/call-sounds';

// Per-voice accent hue (display only) — ported from the original demo.
const VOICE_HUE: Record<string, string> = {
  koi: '#a63bbd',
  finn: '#2f9e8f',
  marlin: '#c07b2f',
};

// Region flag + English label per language id.
const REGION: Record<string, { flag: string; country: string; lang: string }> = {
  en: { flag: '🇺🇸', country: 'United States', lang: 'English' },
  zh: { flag: '🇨🇳', country: '中国', lang: 'Chinese' },
  ja: { flag: '🇯🇵', country: '日本', lang: 'Japanese' },
};

// Fish logo — static brand bars (viewBox 30 168 452 160).
const FISH_BARS = [
  { x: 38.1, y: 200, h: 19.4 },
  { x: 71, y: 202.7, h: 30.7 },
  { x: 103.9, y: 198.4, h: 77.4 },
  { x: 136.9, y: 192, h: 20 },
  { x: 136.9, y: 245.4, h: 58.3 },
  { x: 168.6, y: 235.1, h: 100.8 },
  { x: 200.6, y: 222.4, h: 102.2 },
  { x: 232.6, y: 204.1, h: 115.8 },
  { x: 264.5, y: 190.2, h: 120.1 },
  { x: 297.1, y: 181.9, h: 107.1 },
  { x: 328.9, y: 177, h: 87.8 },
  { x: 360.9, y: 175, h: 86.6 },
  { x: 392.9, y: 178.1, h: 75.4 },
  { x: 424.7, y: 185.2, h: 60.2 },
  { x: 456.7, y: 204.1, h: 38 },
];

// Operator / headset glyph — "a support voice you can call".
function OperatorGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="12.5" width="4.5" height="7" rx="2.2" />
      <rect x="17" y="12.5" width="4.5" height="7" rx="2.2" />
      <path d="M20 19.5v.5a3 3 0 0 1-3 3h-3" />
    </svg>
  );
}

const VSTATE_COPY: Record<string, { label: string; hint: React.ReactNode }> = {
  idle: { label: 'Idle', hint: 'Start the demo and speak to the agent' },
  listening: { label: 'Listening', hint: 'you’re speaking' },
  thinking: {
    label: 'Thinking',
    hint: (
      <span className="thinking-dots">
        <i />
        <i />
        <i />
      </span>
    ),
  },
  speaking: { label: 'Speaking', hint: 'Fish TTS streaming' },
};

interface LeadQualViewProps {
  appConfig: { pageTitle: string; pageDescription: string };
  language: string;
  voice: string;
  onLanguageChange: (id: string) => void;
  onVoiceChange: (id: string) => void;
}

export function LeadQualView({
  appConfig,
  language,
  voice,
  onLanguageChange,
  onVoiceChange,
}: LeadQualViewProps) {
  const session = useSessionContext();
  const { state, audioTrack } = useVoiceAssistant();
  const room = useRoomContext();
  const { mergedProps: audioGateProps } = useStartAudio({ room, props: {} });

  const { isConnected, start, end, prepareConnection } = session;
  // -Infinity so the FIRST hover always warms — a 0 init would be wrongly throttled
  // during the first 12s (performance.now() is still < 12000 right after load).
  const lastWarmRef = useRef(Number.NEGATIVE_INFINITY);

  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [wantStart, setWantStart] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [perfEnabled, setPerfEnabled] = useState(false);
  const [perfLines, setPerfLines] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const perfEnabledRef = useRef(false);
  const perfT0Ref = useRef<number | null>(null);
  const firstAgentSpeechSeenRef = useRef(false);
  const micEnabledAfterOpenerRef = useRef(false);
  const micEnableInFlightRef = useRef(false);
  const soundsRef = useRef<CallSounds | null>(null);
  const connectedCueRef = useRef(false);
  // Bumped on every call boundary (start/end/disconnect); an in-flight async mic-enable
  // from a previous call only mutates state if its captured seq still matches.
  const callSeqRef = useRef(0);
  // Latest agent state, readable from timeouts (whose closures would otherwise be stale).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Real MediaStreamTracks for the waveform: agent (from the assistant) + local mic.
  const agentMst = audioTrack?.publication?.track?.mediaStreamTrack;
  const micMst = isConnected
    ? session.local.microphoneTrack?.publication?.track?.mediaStreamTrack
    : undefined;
  useWaveform(canvasRef, agentMst, micMst, isConnected);

  // Voice state derived from the agent's reported state.
  const vs = state === 'listening' || state === 'thinking' || state === 'speaking' ? state : 'idle';
  const agentReady = vs !== 'idle';
  const halo = vs === 'speaking' ? 0.55 : vs === 'listening' ? 0.4 : vs === 'thinking' ? 0.3 : 0.18;

  // Live status pill.
  let liveCls = '';
  let liveLabel = 'idle';
  if (err || state === 'failed') {
    liveCls = 'err';
    liveLabel = 'error';
  } else if (starting && !isConnected) {
    liveLabel = 'connecting…';
  } else if (isConnected) {
    liveCls = agentReady ? 'on' : 'warn';
    liveLabel = agentReady ? 'live' : 'waking agent…';
  }

  const callActive = isConnected || starting;

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).has('perf');
    perfEnabledRef.current = enabled;
    setPerfEnabled(enabled);
  }, []);

  const markPerf = useCallback((name: string) => {
    if (!perfEnabledRef.current || perfT0Ref.current === null) return;
    const ms = Math.round(performance.now() - perfT0Ref.current);
    const line = `${String(ms).padStart(5)}ms  ${name}`;
    console.log(`⏱ ${name}`, `${ms}ms`);
    setPerfLines((lines) => [...lines, line].slice(-40));
  }, []);

  function startPerf() {
    if (!perfEnabledRef.current) return;
    perfT0Ref.current = performance.now();
    setPerfLines(['    0ms  click']);
    console.log('⏱ click', '0ms');
  }

  // Reset the per-call cue state (mic gate + connect chime). Safe to call repeatedly
  // while connecting — it does NOT touch the ringback (a dedicated effect owns that).
  function resetMicGate() {
    callSeqRef.current += 1; // invalidate any in-flight mic-enable from a prior call
    firstAgentSpeechSeenRef.current = false;
    micEnabledAfterOpenerRef.current = false;
    micEnableInFlightRef.current = false;
    connectedCueRef.current = false;
  }

  // Publish the caller mic. Guarded by a captured call-seq so a slow enable from a
  // previous call can't pollute a newer one, and by the in-flight/enabled flags so it
  // never double-publishes. Errors are surfaced (a silent failure would leave the UI
  // "live" while the agent hears nothing).
  const enableMic = useCallback(
    (label: string) => {
      if (micEnabledAfterOpenerRef.current || micEnableInFlightRef.current) return;
      micEnableInFlightRef.current = true;
      const seq = callSeqRef.current;
      markPerf(label);
      void room.localParticipant
        .setMicrophoneEnabled(
          true,
          { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          { preConnectBuffer: false }
        )
        .then(() => {
          if (seq !== callSeqRef.current) return; // a newer call started — ignore
          micEnabledAfterOpenerRef.current = true;
          markPerf('mic enabled');
        })
        .catch((e) => {
          if (seq !== callSeqRef.current) return;
          setErr(e instanceof Error ? e.message : 'Could not enable microphone.');
          markPerf('mic enable failed');
        })
        .finally(() => {
          if (seq === callSeqRef.current) micEnableInFlightRef.current = false;
        });
    },
    [room.localParticipant, markPerf]
  );

  async function beginCall() {
    if (isConnected) return;
    setErr(null);
    setStarting(true);
    try {
      markPerf('session.start begin');
      // Let the agent always speak first. We connect and subscribe to the agent audio
      // immediately, but do not publish the caller mic until after the first opener has
      // played; otherwise background speech can reach STT before the greeting.
      await start({ tracks: { microphone: { enabled: false } } });
      markPerf('session.start resolved');
    } catch (e) {
      markPerf('session.start failed');
      setErr(e instanceof Error ? e.message : 'Could not start the call.');
    } finally {
      setStarting(false);
    }
  }

  // Re-warm the connection the moment the user hovers the picker — just before they
  // click. The SDK already prepareConnection()s once on mount (DNS/TLS/edge lookup), but
  // that TLS goes idle if the user lingers; a hover re-warm keeps it hot at click time so
  // room.connect() reuses a live path. Throttled so repeated hovers don't spam /api/token.
  function warmConnection() {
    if (callActive) return;
    const now = performance.now();
    if (now - lastWarmRef.current < 12_000) return;
    lastWarmRef.current = now;
    markPerf('prewarm connection');
    void prepareConnection().catch(() => {});
  }

  // Click a voice = SELECT it, then start on the next render (so the fresh
  // language/voice is already baked into the token source / agentMetadata).
  function clickVoice(id: string) {
    if (callActive) return;
    startPerf();
    resetMicGate();
    // Gentle ringback while connecting (armed here so autoplay honors the gesture);
    // it stops + gives a soft "connected" chime once the agent audio arrives. The sound
    // is cosmetic — never let an audio failure block the call from starting.
    try {
      if (!soundsRef.current) soundsRef.current = createCallSounds(markPerf);
      soundsRef.current.arm();
      soundsRef.current.startRing();
    } catch (e) {
      markPerf(`ring unavailable: ${e instanceof Error ? e.name : 'err'}`);
    }
    // Unlock audio playback NOW, inside the synchronous click gesture — before the async
    // connect. The worker speaks its opener the instant the room connects; if playback
    // isn't already unlocked, the browser engages it a beat late (RoomAudioRenderer only
    // renders AFTER subscription) and the first words are dropped. This mirrors the old
    // vanilla client's gesture-time primeAudio(); browser autoplay policy only honors the
    // unlock when it rides a real user gesture, so it must happen here, not after start().
    void room
      .startAudio()
      .then(() => markPerf(`startAudio ok (${room.canPlaybackAudio ? 'playback on' : 'pending'})`))
      .catch((e) => markPerf(`startAudio blocked: ${e instanceof Error ? e.name : 'error'}`));
    onVoiceChange(id);
    setWantStart(true);
  }
  useEffect(() => {
    if (!wantStart) return;
    setWantStart(false);
    // useSession stores the {language, voice} fetch options in a ref it updates in
    // a PASSIVE effect on the parent fiber — which runs AFTER this descendant effect
    // in the same commit. Calling start() synchronously here would mint the token
    // with the PREVIOUS selection's agentMetadata (the race bites the first time you
    // pick a non-default voice). Deferring to a microtask drains after the whole
    // passive-effect pass, so the parent's ref already holds the fresh selection.
    queueMicrotask(() => void beginCall());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantStart, voice, language]);

  function selectRegion(id: string) {
    setMenuOpen(false);
    if (callActive || id === language) return;
    onLanguageChange(id);
  }

  async function endCall() {
    try {
      markPerf('end clicked');
      resetMicGate();
      await end();
    } catch {
      /* ignore */
    }
  }

  // Close the region menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.region')) setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuOpen]);

  // 'failed' is a terminal agent state (SDK) — surface it, but do NOT auto-end():
  // during a shaky cross-Pacific connect the SDK can briefly report 'failed', and
  // calling end() here tore live calls down in <1s (CLIENT_INITIATED disconnect seen
  // in the worker logs). Just show the error; the picker unlocks on its own once the
  // session settles to disconnected, and the user can retry with the End button.
  useEffect(() => {
    if (state !== 'failed') return;
    setErr('The agent failed to connect. Please try again.');
  }, [state]);

  // Auto-clear a transient error after a few seconds.
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 6000);
    return () => clearTimeout(t);
  }, [err]);

  useEffect(() => {
    const onSignalConnected = () => markPerf('signal connected');
    const onConnectionStateChanged = (connectionState: unknown) =>
      markPerf(`room state ${String(connectionState)}`);
    const onParticipantConnected = (participant: { identity?: string }) =>
      markPerf(`participant ${participant.identity ?? 'unknown'} connected`);
    const onLocalTrackPublished = (publication: { source?: string }) =>
      markPerf(`local track published ${publication.source ?? 'unknown'}`);
    const onTrackSubscribed = (
      track: { kind?: string; attachedElements?: unknown[] },
      _publication: unknown,
      participant: { identity?: string }
    ) => {
      if (track.kind !== Track.Kind.Audio) return;
      markPerf(`audio track subscribed ${participant.identity ?? 'unknown'}`);
      requestAnimationFrame(() =>
        markPerf(`audio elements attached ${track.attachedElements?.length ?? 0}`)
      );
    };
    const onAudioPlaybackStatusChanged = (enabled: boolean) =>
      markPerf(`audio playback ${enabled ? 'on' : 'blocked'}`);

    room
      .on(RoomEvent.SignalConnected, onSignalConnected)
      .on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged)
      .on(RoomEvent.ParticipantConnected, onParticipantConnected)
      .on(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackStatusChanged);

    return () => {
      room
        .off(RoomEvent.SignalConnected, onSignalConnected)
        .off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged)
        .off(RoomEvent.ParticipantConnected, onParticipantConnected)
        .off(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
        .off(RoomEvent.TrackSubscribed, onTrackSubscribed)
        .off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackStatusChanged);
    };
  }, [room, markPerf]);

  useEffect(() => {
    if (isConnected) markPerf('session connected state');
  }, [isConnected, markPerf]);

  useEffect(() => {
    if (!audioTrack) return;
    markPerf('agent audioTrack hook ready');
    // Agent audio has arrived → the call is "connected": stop the ringback and play a
    // soft chime (once), just before the gated opener starts.
    if (!connectedCueRef.current) {
      connectedCueRef.current = true;
      soundsRef.current?.stopRing();
      soundsRef.current?.playConnected();
    }
  }, [audioTrack, markPerf]);

  // Safety net a few seconds in. "Agent speaks first" is a hard rule, so we only
  // recover the mic if the opener DID play (firstAgentSpeechSeen) but the
  // speaking→listening transition was somehow missed. If the agent never greeted, we
  // do NOT open the mic (that would let background speech reach STT before any
  // greeting) — we surface an error and let the user retry instead.
  useEffect(() => {
    if (!isConnected) return;
    const t = setTimeout(() => {
      if (micEnabledAfterOpenerRef.current || micEnableInFlightRef.current) return;
      if (!firstAgentSpeechSeenRef.current) {
        // Agent never greeted — keep the mic off (agent must speak first), surface it.
        markPerf('opener missing (mic kept off)');
        setErr('The agent did not greet. Please end the call and try again.');
      } else if (stateRef.current !== 'speaking') {
        // Opener played and it's not mid-utterance — safe to recover the mic.
        enableMic('mic enable fallback');
      }
      // else: opener still playing (rare, >8s) — defer to the normal speaking→listening path.
    }, 8000);
    return () => clearTimeout(t);
  }, [isConnected, enableMic, markPerf]);

  // Ringback lifecycle: it starts in clickVoice and is stopped either by the connect
  // chime (agent audio arrived) or here, once we're neither connecting nor connected
  // (idle / errored / ended). Keeps the ring from surviving a failed or finished call.
  useEffect(() => {
    if (!starting && !isConnected) soundsRef.current?.stopRing();
  }, [starting, isConnected]);

  // Release the call-sounds AudioContext on unmount.
  useEffect(() => () => soundsRef.current?.dispose(), []);

  useEffect(() => {
    if (!isConnected) {
      resetMicGate();
      return;
    }
    if (state === 'speaking') {
      firstAgentSpeechSeenRef.current = true;
      return;
    }
    if (
      state !== 'listening' ||
      !firstAgentSpeechSeenRef.current ||
      micEnabledAfterOpenerRef.current ||
      micEnableInFlightRef.current
    ) {
      return;
    }

    enableMic('mic enable after opener');
  }, [isConnected, state, enableMic]);

  const cur = REGION[language] ?? REGION.en;
  const copy = VSTATE_COPY[vs];

  return (
    <div className="app">
      {/* ===== header ===== */}
      <header>
        <div className="brand">
          <svg
            viewBox="30 168 452 160"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: 'var(--ink)' }}
          >
            {FISH_BARS.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width="16" height={b.h} rx="8" fill="currentColor" />
            ))}
          </svg>
          <div className="txt">
            <span className="t1">{appConfig.pageTitle}</span>
            <span className="t2">{appConfig.pageDescription}</span>
          </div>
        </div>
        <div className="hd-right">
          <span className={`live ${liveCls}`}>
            <i />
            <span>{liveLabel}</span>
          </span>
        </div>
      </header>

      {/* ===== main ===== */}
      <main>
        <div className="col voice-col">
          <div className="voice-body" style={{ ['--halo' as string]: String(halo) }}>
            {/* region × voice picker */}
            <div
              className={callActive ? 'picker locked' : 'picker'}
              onPointerEnter={warmConnection}
            >
              <div className="region">
                <button
                  className="region-btn"
                  disabled={callActive}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((o) => !o);
                  }}
                >
                  <span className="flag">{cur.flag}</span>
                  <span>
                    {cur.country} · {cur.lang}
                  </span>
                  <span className="car">▾</span>
                </button>
                {menuOpen && (
                  <div className="region-menu open">
                    {LANGUAGES.map((l) => {
                      const r = REGION[l.id] ?? { flag: '', country: l.name, lang: l.name };
                      return (
                        <button
                          key={l.id}
                          className={l.id === language ? 'on' : ''}
                          onClick={() => selectRegion(l.id)}
                        >
                          <span className="rflag">{r.flag}</span>
                          <span>{r.country}</span>
                          <span className="sub">{r.lang}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pick-hint">
                {callActive
                  ? 'On call — end the call to switch language or voice'
                  : 'Pick an agent voice to start the call'}
              </div>

              <div className="voices">
                {VOICES.map((v) => {
                  const on = v.id === voice;
                  const hue = VOICE_HUE[v.id] ?? 'var(--accent)';
                  return (
                    <button
                      key={v.id}
                      className={on ? 'vchip on' : 'vchip'}
                      disabled={callActive}
                      style={{ ['--vc' as string]: hue, ['--vcs' as string]: `${hue}22` }}
                      title={v.name}
                      onClick={() => clickVoice(v.id)}
                    >
                      <span className="vava">
                        <OperatorGlyph />
                      </span>
                      <span className="vn">{v.name}</span>
                      <span className="go">{callActive ? (on ? '● on call' : '') : 'Call'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* End call — outside .picker so locking the picker can't disable it */}
            {isConnected && (
              <button className="hangup" onClick={endCall}>
                ■ End call
              </button>
            )}

            <canvas id="wave" ref={canvasRef} />

            <div className={`vstate ${vs === 'idle' ? '' : vs}`}>
              <div className="lbl">{copy.label}</div>
              <div className="hint">{copy.hint}</div>
            </div>

            {/* Audio-playback gate: mergedProps carries onClick + a display:none
                style that self-hides it once playback is unblocked. Our className
                comes last so the paper styling wins over the SDK's default. */}
            <button {...audioGateProps} className="btn end audiogate">
              Enable audio output
            </button>
          </div>
        </div>
      </main>

      {/* ===== telemetry footer ===== */}
      <footer>
        <div className="pipe">
          <span className={vs === 'listening' ? 'node on' : 'node'}>
            <i />
            Mic
          </span>
          <span className="arrow">→</span>
          <span className={vs === 'listening' ? 'node on' : 'node'}>
            <i />
            STT
          </span>
          <span className="arrow">→</span>
          <span className={vs === 'thinking' ? 'node on' : 'node'}>
            <i />
            Reasoning
          </span>
          <span className="arrow">→</span>
          <span className={vs === 'speaking' ? 'node on' : 'node'}>
            <i />
            Fish TTS
          </span>
        </div>
      </footer>

      {err && <div className="errbar">{err}</div>}
      {perfEnabled && <pre className="perf-log">{perfLines.join('\n')}</pre>}
    </div>
  );
}
