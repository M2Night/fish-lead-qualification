'use client';

import { useEffect, useRef } from 'react';

/**
 * Audio-reactive bar waveform — ported from the original vanilla demo
 * (web/public/index.html). Draws real energy from whichever track is active
 * (agent while speaking, mic while the user talks) with a gentle idle breath
 * fallback. Colors are read from the paper theme's --wave-a / --wave-b vars.
 */
type Probe = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
} | null;

const NB = 48; // bar count

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function energy(an: AnalyserNode | null, buf: Uint8Array<ArrayBuffer> | null): number {
  if (!an || !buf) return 0;
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

export function useWaveform(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  agentTrack: MediaStreamTrack | undefined,
  micTrack: MediaStreamTrack | undefined,
  active: boolean
) {
  const activeRef = useRef(active);
  activeRef.current = active;

  const ctxRef = useRef<AudioContext | null>(null);
  const agentProbe = useRef<Probe>(null);
  const micProbe = useRef<Probe>(null);

  // Lazily create the shared AudioContext and (re)attach a probe when a track changes.
  // Only spin the context up once there's actually a track to analyse — by then a
  // connect has happened off a user gesture, so resume() succeeds (creating it on
  // mount can leave it suspended and the waveform inert).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!agentTrack && !micTrack) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ctx = ctxRef.current;

    function attach(track: MediaStreamTrack | undefined, ref: React.RefObject<Probe>) {
      if (ref.current) {
        try {
          ref.current.source.disconnect();
        } catch {
          /* already gone */
        }
        ref.current = null;
      }
      if (!track) return;
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser); // analyser is a sink — no onward connection, no double audio
      ref.current = { source, analyser, data: new Uint8Array(analyser.fftSize) };
    }

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    attach(agentTrack, agentProbe);
    attach(micTrack, micProbe);
  }, [agentTrack, micTrack]);

  // Release the audio graph + context once, on unmount (not on every track change).
  useEffect(() => {
    return () => {
      for (const ref of [agentProbe, micProbe]) {
        try {
          ref.current?.source.disconnect();
        } catch {
          /* already gone */
        }
        ref.current = null;
      }
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  // Draw loop + canvas sizing.
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const cx = cvs.getContext('2d');
    if (!cx) return;

    function fit() {
      const dpr = window.devicePixelRatio || 1;
      const r = cvs!.getBoundingClientRect();
      cvs!.width = r.width * dpr;
      cvs!.height = r.height * dpr;
      cx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fit();
    window.addEventListener('resize', fit);

    function roundRect(x: number, y: number, w: number, h: number, r: number) {
      cx!.beginPath();
      cx!.moveTo(x + r, y);
      cx!.arcTo(x + w, y, x + w, y + h, r);
      cx!.arcTo(x + w, y + h, x, y + h, r);
      cx!.arcTo(x, y + h, x, y, r);
      cx!.arcTo(x, y, x + w, y, r);
      cx!.closePath();
      cx!.fill();
    }

    let raf = 0;
    let phase = 0;
    // Reused across frames (fftSize 256 → 128 bins) to avoid per-frame allocation.
    const freqBuf = new Uint8Array(128);
    function draw() {
      raf = requestAnimationFrame(draw);
      const w = cvs!.clientWidth;
      const h = cvs!.clientHeight;
      if (!w) return;
      cx!.clearRect(0, 0, w, h);
      phase += 0.03;

      let an: AnalyserNode | null = null;
      let amp = 0;
      if (activeRef.current) {
        const aE = energy(agentProbe.current?.analyser ?? null, agentProbe.current?.data ?? null);
        const mE = energy(micProbe.current?.analyser ?? null, micProbe.current?.data ?? null);
        if (aE > 0.012) {
          an = agentProbe.current!.analyser;
          amp = aE;
        } else if (mE > 0.012) {
          an = micProbe.current!.analyser;
          amp = mE;
        } else {
          amp = 0.006;
        }
      }

      const mid = h / 2;
      const gap = w / NB;
      const grad = cx!.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, cssVar('--wave-a'));
      grad.addColorStop(1, cssVar('--wave-b'));
      cx!.fillStyle = grad;

      let freq: Uint8Array<ArrayBuffer> | null = null;
      if (an) {
        freq = freqBuf;
        an.getByteFrequencyData(freqBuf);
      }

      for (let i = 0; i < NB; i++) {
        let v: number;
        if (freq) {
          const idx = Math.floor((i / NB) * freq.length * 0.7);
          v = freq[idx] / 255;
        } else {
          v = amp * 8 * (0.5 + 0.5 * Math.sin(phase + i * 0.4));
        }
        const bh = Math.max(2, v * (h * 0.9));
        const x = i * gap + gap * 0.18;
        const bw = gap * 0.5;
        roundRect(x, mid - bh / 2, bw, bh, bw / 2);
      }
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [canvasRef]);
}
