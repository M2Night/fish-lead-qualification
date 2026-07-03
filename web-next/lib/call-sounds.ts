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

export function createCallSounds(log: (msg: string) => void = () => {}): CallSounds {
  let ctx: AudioContext | null = null;
  let ringTimer: ReturnType<typeof setInterval> | null = null;
  let ringStopTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by stopRing()/dispose(); an in-flight async resume callback only plays if its
  // captured token still matches (so a stopped/disposed ring can't fire a stale pulse or
  // resurrect a closed AudioContext).
  let ringToken = 0;

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

  function disconnectOnEnded(o: OscillatorNode, g: GainNode) {
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  // Some mobile/WebKit autoplay paths only fully unlock Web Audio when a source is
  // started inside the user gesture, not only after resume() resolves.
  function primeOutput(c: AudioContext) {
    const t = c.currentTime;
    const g = c.createGain();
    g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 440;
    o.connect(g);
    disconnectOnEnded(o, g);
    o.start(t);
    o.stop(t + 0.02);
  }

  // One warm ring pulse. Gentle envelope, audible but not piercing. Scheduled a hair
  // in the future so a just-resumed context still plays it (t=currentTime can be stale
  // for the very first pulse right after resume()).
  function ringPulse(c = ac()) {
    if (c.state !== 'running') void c.resume();
    log(`ring:pulse state=${c.state} t=${c.currentTime.toFixed(2)}`);
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
    disconnectOnEnded(o, g);
    o.start(t);
    o.stop(t + 0.53);
    return t + 0.53;
  }

  function arm() {
    const c = ac();
    primeOutput(c);
    if (c.state === 'suspended') void c.resume();
    log(`ring:arm state=${c.state}`);
  }

  function startRing() {
    stopRing(); // invalidates any prior ring token + clears timers
    const c = ac();
    const token = ringToken;
    log(`ring:start state=${c.state}`);
    // Guarded so a resume that resolves after stop/dispose can't fire a stale pulse or
    // resurrect a closed context (ctx would differ or the token would have moved on).
    const guardedPulse = () => {
      if (token !== ringToken || ctx !== c) return null;
      return ringPulse(c);
    };
    // Schedule the first audible pulse in the click gesture. The +0.03s lead in ringPulse
    // keeps it safe for a context that is just being resumed, while staying inside the
    // browser's user-activation window.
    const firstPulseEnd = guardedPulse();
    if (c.state === 'suspended') {
      c.resume()
        .then(() => {
          log(`ring:resumed state=${c.state}`);
          if (firstPulseEnd !== null && c.currentTime > firstPulseEnd) guardedPulse();
        })
        .catch((e) => log(`ring:resume-fail ${e instanceof Error ? e.name : 'err'}`));
    }
    ringTimer = setInterval(guardedPulse, 1600); // slow, unhurried cadence
    ringStopTimer = setTimeout(stopRing, 20_000); // hard cap so it never rings forever
  }

  function stopRing() {
    ringToken += 1; // invalidate any pending resume callback / interval tick
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
      disconnectOnEnded(o, g);
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
