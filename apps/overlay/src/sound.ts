import type { ArenaView } from '../../server/src/model.js';
import { CueDetector, type Cue } from './cues.js';

// Original synthesized cue patterns. Waveforms are dedicated to CC0-1.0.
const notes: Readonly<Record<Cue, readonly number[]>> = {
  keyword: [660, 880],
  gate: [180],
  weak: [440, 660, 880],
  gg: [523, 659, 784, 1047],
};

/** Creates no audio device until the host opts in; all cues are short and quiet. */
export class Sound {
  private readonly detector = new CueDetector();
  private context?: AudioContext;
  private gain?: GainNode;
  private enabled = false;
  private readonly playing = new Set<OscillatorNode>();

  update(view: ArenaView): void {
    this.enabled = view.sound === true;
    if (!this.enabled) {
      for (const voice of this.playing) {
        try {
          voice.stop();
        } catch {
          /* Already finished. */
        }
      }
      this.playing.clear();
      if (this.gain && this.context) this.gain.gain.setValueAtTime(0, this.context.currentTime);
    }
    for (const cue of this.detector.update(view)) void this.play(cue);
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.audio().resume();
    } catch {
      /* OBS supports autoplay; browser previews may require interaction. */
    }
  }

  private audio(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  private async play(cue: Cue): Promise<void> {
    try {
      const context = this.audio();
      if (context.state === 'suspended') await context.resume();
      if (!this.enabled || context.state !== 'running' || !this.gain) return;
      this.gain.gain.setValueAtTime(0.065, context.currentTime);
      notes[cue].forEach((frequency, index) => {
        const at = context.currentTime + index * 0.085;
        const voice = context.createOscillator();
        const envelope = context.createGain();
        voice.type = cue === 'gate' ? 'triangle' : 'sine';
        voice.frequency.setValueAtTime(frequency, at);
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(0.8, at + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
        voice.connect(envelope);
        envelope.connect(this.gain!);
        this.playing.add(voice);
        voice.onended = () => {
          this.playing.delete(voice);
          voice.disconnect();
          envelope.disconnect();
        };
        voice.start(at);
        voice.stop(at + 0.13);
      });
    } catch {
      /* Audio must never interrupt the overlay. */
    }
  }
}
