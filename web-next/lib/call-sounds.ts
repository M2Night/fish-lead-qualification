'use client';

/**
 * Synthesized call sounds (no audio assets) — a gentle ringback while the call
 * connects and a soft two-note chime when the agent joins. Deliberately warm and
 * low-volume (sine tones, slow cadence) so it never feels harsh or urgent.
 *
 * Must be armed from a user gesture (the Call click) so the browser lets the
 * AudioContext play.
 */
export type CallSounds = {
  /** Create + resume the AudioContext — call this inside the click gesture. */
  arm: () => void;
  /** Start the repeating ringback. */
  startRing: () => void;
  /** Stop the ringback. */
  stopRing: () => void;
  /** Soft "connected" chime (played when the agent joins). */
  playConnected: () => void;
  /** Release the AudioContext. */
  dispose: () => void;
};

export function createCallSounds(): CallSounds {
  let ctx: AudioContext | null = null;
  let ringTimer: ReturnType<typeof setInterval> | null = null;
  let ringStopTimer: ReturnType<typeof setTimeout> | null = null;

  function ac(): AudioContext {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  // One warm, soft ring pulse. Low gain + gentle envelope = not piercing.
  function ringPulse() {
    const c = ac();
    const t = c.currentTime;
    const g = c.createGain();
    g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
    g.gain.setValueAtTime(0.03, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 430; // warm mid tone, not a harsh telephone beat
    o.connect(g);
    o.start(t);
    o.stop(t + 0.48);
  }

  function arm() {
    ac();
  }

  function startRing() {
    stopRing();
    ringPulse();
    ringTimer = setInterval(ringPulse, 1600); // slow, unhurried cadence
    ringStopTimer = setTimeout(stopRing, 20_000); // hard cap so it never rings forever
  }

  function stopRing() {
    if (ringTimer) {
      clearInterval(ringTimer);
      ringTimer = null;
    }
    if (ringStopTimer) {
      clearTimeout(ringStopTimer);
      ringStopTimer = null;
    }
  }

  // Soft rising two-note chime (C5 → E5) — a friendly "connected", low volume.
  function playConnected() {
    const c = ac();
    const t = c.currentTime;
    (
      [
        [523.25, 0],
        [659.25, 0.12],
      ] as const
    ).forEach(([f, dt]) => {
      const g = c.createGain();
      g.connect(c.destination);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.045, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.34);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(t + dt);
      o.stop(t + dt + 0.38);
    });
  }

  function dispose() {
    stopRing();
    if (ctx) {
      void ctx.close();
      ctx = null;
    }
  }

  return { arm, startRing, stopRing, playConnected, dispose };
}
