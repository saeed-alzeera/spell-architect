// Procedural WebAudio: all sound effects and a generative music loop. No asset files.
import { store } from './save';

type Sfx =
  | 'arcane' | 'fire' | 'ice' | 'lightning' | 'poison' | 'water' | 'gravity'
  | 'hit' | 'kill' | 'hurt' | 'gem' | 'level' | 'reaction' | 'boom' | 'boss' | 'ui' | 'pick' | 'warn' | 'win' | 'lose' | 'freeze';

interface VoiceOpts {
  slide?: number;
  at?: number;
  dest?: AudioNode;
  detune?: number;
  lp?: number;
  attack?: number;
  jitter?: number;
}

// Music: A minor, 8-bar form (Am F C G | Am F G Am), 16th-note grid.
const BPM = 100;
const STEP = 60 / BPM / 4;
const ROOTS = [0, -4, 3, -2, 0, -4, -2, 0];
const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
const QUAL = [MINOR, MAJOR, MAJOR, MAJOR, MINOR, MAJOR, MAJOR, MINOR];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];
const ROOT_HZ = 110;
const hz = (semi: number, base = ROOT_HZ) => base * Math.pow(2, semi / 12);

class AudioSys {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxG!: GainNode;
  musG!: GainNode;
  arpBus!: GainNode;
  reverbIn!: GainNode;
  noiseBuf: AudioBuffer | null = null;
  last: Record<string, number> = {};
  musicTimer: number | undefined;
  step = 0;
  nextTime = 0;
  melodyIdx = 3;
  intensity = 0;
  /** Smoothed intensity so the drums fade in and out instead of snapping. */
  private feel = 0;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.sfxG = c.createGain();
    this.musG = c.createGain();
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfxG.connect(this.master);
    this.musG.connect(this.master);

    // Shared reverb: gives every sound a sense of space.
    this.reverbIn = c.createGain();
    const verb = c.createConvolver();
    verb.buffer = this.makeImpulse(2.4);
    const verbOut = c.createGain();
    verbOut.gain.value = 0.7;
    this.reverbIn.connect(verb); verb.connect(verbOut); verbOut.connect(this.master);
    const sfxSend = c.createGain(); sfxSend.gain.value = 0.22;
    const musSend = c.createGain(); musSend.gain.value = 0.5;
    this.sfxG.connect(sfxSend); sfxSend.connect(this.reverbIn);
    this.musG.connect(musSend); musSend.connect(this.reverbIn);

    // Dotted-eighth echo for the arpeggio.
    this.arpBus = c.createGain();
    const delay = c.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const echoTone = c.createBiquadFilter(); echoTone.type = 'lowpass'; echoTone.frequency.value = 2400;
    const echoSend = c.createGain(); echoSend.gain.value = 0.45;
    this.arpBus.connect(this.musG);
    this.arpBus.connect(echoSend); echoSend.connect(delay);
    delay.connect(echoTone); echoTone.connect(fb); fb.connect(delay);
    echoTone.connect(this.musG);

    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = 1 - i / len;
        // One-pole lowpass that closes over time: highs die before lows, like a real room.
        const a = 0.15 + 0.8 * k;
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(k, 2.5);
      }
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = store.settings;
    this.master.gain.value = s.muted ? 0 : s.master;
    this.sfxG.gain.value = s.sfx;
    this.musG.gain.value = s.music * 0.35;
  }

  private throttle(name: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last[name] ?? 0) < ms) return false;
    this.last[name] = now;
    return true;
  }

  /** One enveloped oscillator. Sfx get a little random pitch/detune so repeats don't sound identical. */
  private voice(freq: number, dur: number, type: OscillatorType, vol: number, o: VoiceOpts = {}) {
    const c = this.ctx!;
    const t = o.at ?? c.currentTime;
    const dest = o.dest ?? this.sfxG;
    const jit = o.jitter ?? (dest === this.sfxG ? 0.04 : 0);
    const f0 = freq * (1 + (Math.random() - 0.5) * jit);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f0 + o.slide), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const atk = o.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = osc;
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp;
      osc.connect(f); out = f;
    }
    out.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0, dest?: AudioNode) {
    this.voice(freq, dur, type, vol, { slide, at: this.ctx!.currentTime + delay, dest });
  }

  private noise(dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', slide = 0, at?: number, dest?: AudioNode) {
    const c = this.ctx!;
    const t = at ?? c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest ?? this.sfxG);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  /** Two slightly detuned oscillators: a fatter, shimmering tone than a lone sine. */
  private chorus(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
    const at = this.ctx!.currentTime + delay;
    this.voice(freq, dur, type, vol * 0.6, { slide, at, detune: -9, jitter: 0 });
    this.voice(freq, dur, type, vol * 0.6, { slide, at, detune: 9, jitter: 0 });
  }

  /** Co-op host: sees every sound request (even when muted) so guests can play the same cues. */
  tap: ((name: string) => void) | null = null;

  play(name: Sfx) {
    this.tap?.(name);
    if (!this.ctx || store.settings.muted) return;
    const lim: Record<string, number> = {
      fire: 60, ice: 60, lightning: 50, poison: 80, water: 80, gravity: 100, hit: 35, kill: 30, gem: 40, hurt: 120,
      reaction: 80, boom: 50, freeze: 80,
    };
    if (!this.throttle(name, lim[name] ?? 0)) return;
    switch (name) {
      case 'arcane':
        this.chorus(700, 0.14, 'triangle', 0.09, 300);
        this.tone(1050, 0.1, 'sine', 0.04, 200, 0.03);
        this.tone(1575, 0.2, 'sine', 0.025, 0, 0.05);
        break;
      case 'fire':
        this.noise(0.22, 0.2, 900, 0.8, 'bandpass', -500);
        this.noise(0.1, 0.08, 3000, 1, 'highpass');
        this.voice(180, 0.14, 'sawtooth', 0.05, { slide: -80, lp: 700 });
        break;
      case 'ice':
        this.tone(1400, 0.16, 'triangle', 0.08, -600);
        this.tone(2100, 0.1, 'sine', 0.04, -900);
        this.tone(2800, 0.07, 'sine', 0.025, -1200, 0.02);
        break;
      case 'lightning':
        this.noise(0.12, 0.18, 3500, 2, 'highpass');
        this.noise(0.05, 0.14, 6000, 1, 'highpass', 0, this.ctx.currentTime + 0.04);
        this.tone(900, 0.07, 'square', 0.04, -700);
        this.tone(120, 0.12, 'sawtooth', 0.06, -60);
        break;
      case 'poison':
        this.tone(220, 0.22, 'sine', 0.09, 120);
        this.tone(330, 0.18, 'sine', 0.05, -100, 0.06);
        this.noise(0.12, 0.06, 500, 3);
        break;
      case 'water':
        this.tone(520, 0.14, 'sine', 0.09, 400);
        this.tone(780, 0.1, 'sine', 0.05, 300, 0.05);
        break;
      case 'gravity':
        this.tone(110, 0.32, 'sine', 0.14, -60);
        this.tone(55, 0.32, 'triangle', 0.12);
        this.noise(0.3, 0.05, 150, 1, 'lowpass');
        break;
      case 'hit': this.noise(0.05, 0.12, 1800, 1.5); this.tone(240, 0.04, 'square', 0.03, -100); break;
      case 'kill':
        this.tone(300, 0.09, 'square', 0.05, -200);
        this.noise(0.1, 0.08, 900, 1);
        this.tone(600, 0.1, 'triangle', 0.04, -300, 0.02);
        break;
      case 'hurt':
        this.voice(150, 0.28, 'sawtooth', 0.18, { slide: -100, lp: 900 });
        this.noise(0.18, 0.15, 400);
        this.tone(80, 0.2, 'sine', 0.14, -30);
        break;
      case 'gem': {
        const f = 880 + Math.floor(Math.random() * 5) * 110;
        this.tone(f, 0.09, 'sine', 0.05);
        this.tone(f * 2, 0.12, 'sine', 0.02, 0, 0.03);
        break;
      }
      case 'level': [523, 659, 784, 1047, 1319].forEach((f, i) => { this.chorus(f, 0.3, 'triangle', 0.12, 0, i * 0.07); }); break;
      case 'reaction':
        this.tone(660, 0.18, 'square', 0.06, 400);
        this.chorus(990, 0.22, 'triangle', 0.07, 300, 0.05);
        this.noise(0.18, 0.1, 2400, 1);
        break;
      case 'boom':
        this.noise(0.4, 0.3, 300, 0.7, 'lowpass', -200);
        this.tone(90, 0.35, 'sine', 0.22, -50);
        this.tone(45, 0.5, 'sine', 0.16, -10);
        break;
      case 'boss':
        this.voice(70, 1.2, 'sawtooth', 0.15, { slide: -20, lp: 500, attack: 0.15 });
        this.voice(105, 1.2, 'square', 0.07, { slide: -30, lp: 600, attack: 0.15 });
        this.tone(35, 1.4, 'sine', 0.2);
        this.noise(0.9, 0.12, 200, 0.6, 'lowpass');
        break;
      case 'ui': this.tone(660, 0.06, 'triangle', 0.06); this.tone(990, 0.05, 'sine', 0.025, 0, 0.02); break;
      case 'pick':
        this.chorus(520, 0.12, 'triangle', 0.09);
        this.chorus(780, 0.18, 'triangle', 0.09, 0, 0.07);
        this.tone(1560, 0.2, 'sine', 0.025, 0, 0.1);
        break;
      case 'warn': this.tone(300, 0.14, 'square', 0.05, 0); this.tone(300, 0.14, 'square', 0.05, 0, 0.18); break;
      case 'freeze': this.tone(1800, 0.22, 'triangle', 0.07, -1200); this.noise(0.12, 0.1, 5000, 2, 'highpass'); this.tone(2600, 0.15, 'sine', 0.03, -1500, 0.03); break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.chorus(f, 0.6, 'triangle', 0.12, 0, i * 0.14));
        [262, 330, 392].forEach((f) => this.tone(f, 1.1, 'sine', 0.08, 0, 0.55));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.voice(f, 0.55, 'sawtooth', 0.09, { slide: -10, lp: 1200, at: this.ctx!.currentTime + i * 0.2 }));
        break;
    }
  }

  /**
   * Generative A-minor loop, scheduled ahead on the audio clock (no setInterval jitter).
   * Layers: pad chords, bass, echoing arpeggio, sparse melody; drums fade in with intensity (0..1).
   */
  private startMusic() {
    this.nextTime = this.ctx!.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }

  private schedule() {
    const c = this.ctx;
    if (!c) return;
    if (store.settings.muted || store.settings.music <= 0 || c.state !== 'running') {
      this.nextTime = Math.max(this.nextTime, c.currentTime + 0.1);
      return;
    }
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.05;
    while (this.nextTime < c.currentTime + 0.25) {
      this.feel += (this.intensity - this.feel) * 0.02;
      this.scheduleStep(this.step++, this.nextTime);
      this.nextTime += STEP;
    }
  }

  private scheduleStep(n: number, t: number) {
    const m = this.musG;
    const s = n % 16;
    const barIdx = Math.floor(n / 16) % ROOTS.length;
    const root = ROOTS[barIdx];
    const chord = QUAL[barIdx];
    const f = this.feel;

    if (s === 0) {
      // Pad: two detuned saws per chord tone through a soft lowpass.
      for (const iv of chord) {
        const fq = hz(root + iv, ROOT_HZ * 2);
        for (const det of [-8, 8]) this.voice(fq, STEP * 16, 'sawtooth', 0.028, { at: t, dest: m, detune: det, lp: 700 + f * 600, attack: 0.9, jitter: 0 });
      }
      this.voice(hz(root), STEP * 15, 'sine', 0.3, { at: t, dest: m, attack: 0.05, jitter: 0 });
    }

    // Bass pulses grow busier with intensity.
    const bassHits = f > 0.25 ? [0, 6, 8, 14] : [0, 8];
    if (bassHits.includes(s) && s !== 0) this.voice(hz(root), STEP * 3, 'triangle', 0.16, { at: t, dest: m, lp: 500, jitter: 0 });

    // Arpeggio on 8th notes, with occasional rests.
    if (s % 2 === 0 && Math.random() < 0.82) {
      const pattern = [0, 1, 2, 1, 2, 1, 0, 2];
      const idx = pattern[(s / 2) % pattern.length];
      const octave = (s % 8 === 6 && Math.random() < 0.4) ? 24 : 12;
      this.voice(hz(root + chord[idx] + octave, ROOT_HZ * 2), 0.28, 'triangle', 0.075, { at: t, dest: this.arpBus, lp: 3000, jitter: 0 });
    }

    // Sparse melody: a random walk on the pentatonic scale, mostly on the strong beats of odd bars.
    if (s % 4 === 0 && (barIdx % 2 === 1 || s === 8) && Math.random() < 0.5) {
      this.melodyIdx = Math.max(0, Math.min(PENTA.length - 1, this.melodyIdx + Math.floor(Math.random() * 5) - 2));
      this.voice(hz(PENTA[this.melodyIdx] + root, ROOT_HZ * 4), 1.1, 'sine', 0.09, { at: t, dest: this.arpBus, attack: 0.03, jitter: 0 });
    }

    // Drums fade in as the fight heats up.
    if (f > 0.2) {
      const v = Math.min(1, (f - 0.2) * 2.5);
      if (s === 0 || s === 8 || (f > 0.6 && s === 10)) this.kick(t, 0.32 * v);
      if (f > 0.45 && (s === 4 || s === 12)) this.snare(t, 0.14 * v);
      if (s % 2 === 0 && f > 0.3) this.noise(0.04, 0.03 * v, 7500, 1, 'highpass', 0, t, m);
      if (s % 2 === 1 && f > 0.65) this.noise(0.03, 0.02 * v, 8500, 1, 'highpass', 0, t, m);
    }
  }

  private kick(t: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.musG);
    o.start(t); o.stop(t + 0.25);
  }

  private snare(t: number, vol: number) {
    this.noise(0.14, vol, 1900, 0.8, 'bandpass', -600, t, this.musG);
    this.voice(190, 0.1, 'triangle', vol * 0.8, { at: t, dest: this.musG, slide: -60, jitter: 0 });
  }
}

export const audio = new AudioSys();
