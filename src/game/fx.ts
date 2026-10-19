/** Sounds (WebAudio, no files) and celebrations (canvas confetti). */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startIn: number, duration: number, type: OscillatorType = 'sine', gain = 0.18): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + startIn;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  clean() {
    tone(880, 0, 0.12, 'triangle');
    tone(1320, 0.08, 0.18, 'triangle');
  },
  late() {
    tone(660, 0, 0.14, 'triangle', 0.14);
  },
  miss() {
    tone(220, 0, 0.22, 'sawtooth', 0.08);
    tone(180, 0.1, 0.25, 'sawtooth', 0.08);
  },
  silence() {
    tone(140, 0, 0.3, 'square', 0.05);
  },
  combo() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.16, 'triangle', 0.16));
  },
  word() {
    tone(1500, 0, 0.04, 'sine', 0.04);
  },
  fanfare() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.15));
  },
  tick() {
    tone(1000, 0, 0.03, 'sine', 0.05);
  },
};

export function unlockAudio(): void {
  audio();
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
}

const COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f8f9fa', '#c77dff'];

export function confetti(canvas: HTMLCanvasElement, count = 140, originY = 0.35): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts: Particle[] = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * originY,
    vx: (Math.random() - 0.5) * 900,
    vy: -Math.random() * 700 - 200,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 12,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    life: 1.6 + Math.random() * 0.8,
  }));
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    c.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      alive++;
      p.vy += 1400 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.globalAlpha = Math.min(1, p.life);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    if (alive > 0) requestAnimationFrame(frame);
    else c.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(frame);
}
