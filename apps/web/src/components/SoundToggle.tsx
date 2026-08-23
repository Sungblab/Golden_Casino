import { useState } from "react";
import { isSoundMuted, setSoundMuted } from "../lib/sound";

/** Shared mute/unmute control, used in both the site header and the in-game bar. */
export function SoundToggle() {
  const [muted, setMuted] = useState(isSoundMuted());
  const toggle = () => {
    const next = !muted;
    setSoundMuted(next);
    setMuted(next);
  };
  return (
    <button type="button" className="mute-button" onClick={toggle} aria-pressed={muted} title={muted ? "소리 켜기" : "소리 끄기"}>
      {muted ? <VolumeOffIcon /> : <VolumeIcon />}
    </button>
  );
}

function VolumeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" /></svg>;
}

function VolumeOffIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m18 9 4 6m0-6-4 6" /></svg>;
}
