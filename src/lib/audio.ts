import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let context: AudioContext | null = null;
let enabled = true;
let vibration = true;
export function configureAudio(sound: boolean, haptics: boolean) { enabled = sound; vibration = haptics; }
export function unlockAudio() {
  if (!enabled) return;
  try { context ??= new AudioContext(); if (context.state === 'suspended') void context.resume().catch(() => {}); } catch { /* Audio is optional. */ }
}
type Effect = 'tap' | 'countdown' | 'go' | 'correct' | 'wrong' | 'win';
export function playSound(effect: Effect) {
  if (vibration && Capacitor.isNativePlatform() && (effect === 'tap' || effect === 'correct')) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  if (!enabled) return;
  unlockAudio();
  if (!context || context.state !== 'running') return;
  const notes: Record<Effect, number[]> = { tap: [520], countdown: [440], go: [440, 660, 880], correct: [523, 659, 784], wrong: [220, 164], win: [523, 659, 784, 1047, 784, 1047] };
  const ctx = context;
  notes[effect].forEach((frequency, i) => {
    const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.105; const duration = effect === 'tap' ? 0.07 : 0.18;
    oscillator.type = effect === 'wrong' ? 'triangle' : 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.065, start + .008); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}