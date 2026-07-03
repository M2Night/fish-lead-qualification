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

  // One warm ring pulse. Gentle envelope, audible but not piercing. Scheduled a hair
  // in the future so a just-resumed context still plays it (t=currentTime can be stale
  // for the very first pulse right after resume()).
  function ringPulse() {
    const c = ac();
    if (c.state !== 'running') void c.resume();
    const t = c.currentTime + 0.03;
    const g = c.createGain();
    g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    g.gain.setValueAtTime(0.08, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 440; // warm mid tone, not a harsh telephone beat
    o.connect(g);
    o.start(t);
    o.stop(t + 0.53);
  }

  function arm() {
    const c = ac();
    if (c.state === 'suspended') void c.resume();
  }

  function startRing() {
    stopRing();
    const c = ac();
    // Play the first pulse only once the context is actually running; otherwise the
    // synchronous pulse is scheduled against a frozen (suspended) clock and is silent.
    if (c.state === 'suspended') {
      c.resume()
        .then(() => ringPulse())
        .catch(() => {});
    } else {
      ringPulse();
    }
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

  // Soft rising two-note chime (C5 → E5) — a friendly "connected".
  function playConnected() {
    const c = ac();
    if (c.state !== 'running') void c.resume();
    const t = c.currentTime + 0.03;
    (
      [
        [523.25, 0],
        [659.25, 0.12],
      ] as const
    ).forEach(([f, dt]) => {
      const g = c.createGain();
      g.connect(c.destination);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.36);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
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
