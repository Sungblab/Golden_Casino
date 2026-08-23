const SOUND_FILES = {
  player: "/sounds/player.mp3",
  banker: "/sounds/banker.mp3",
  tie: "/sounds/tie.mp3",
  chip: "/sounds/chip.mp3",
  deal: "/sounds/deal.mp3",
} as const;

export type SoundName = keyof typeof SOUND_FILES;

const MUTE_KEY = "golden.muted";
const cache = new Map<SoundName, HTMLAudioElement>();
let muted = typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";

function audioFor(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(SOUND_FILES[name]);
    audio.volume = 0.55;
    cache.set(name, audio);
  }
  return audio;
}

/** Plays a sound effect. Silently no-ops when muted or blocked by the browser's autoplay policy. */
export function playSound(name: SoundName): void {
  if (muted) return;
  try {
    const audio = audioFor(name);
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // Missing asset or unsupported format: never let audio break gameplay.
  }
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(next: boolean): void {
  muted = next;
  window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
}
