"""Regenerates apps/web/public/sounds/*.mp3 — all cues are spoken lines via Microsoft Edge's
free neural TTS (the "Read Aloud" voices, no API key required), not sound-designed effects.

Casino/poker terms (player, banker, tie, blackjack, fold, all-in) are read in English —
they're English words either way, and an English voice pronounces them far more naturally
than a Korean voice sounding out the Hangul transliteration. Full Korean sentences (phase
announcements, win/lose, turn notice) are read in Korean.

Requires: pip install edge-tts

Run from repo root:
    python scripts/generate-sounds.py
"""

import asyncio
import pathlib

import edge_tts

VOICE_KO = "ko-KR-SunHiNeural"
VOICE_EN = "en-US-AriaNeural"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "sounds"

# key -> (voice, spoken line). Keys must match SOUND_FILES in apps/web/src/lib/sound.ts.
LINES = {
    "player": (VOICE_EN, "Player Wins"),
    "banker": (VOICE_EN, "Banker Wins"),
    "tie": (VOICE_EN, "Tie"),
    "chip": (VOICE_KO, "베팅을 시작하겠습니다"),
    "deal": (VOICE_KO, "베팅이 마감됐습니다"),
    "win": (VOICE_KO, "승리했습니다"),
    "lose": (VOICE_KO, "패배했습니다"),
    "blackjack": (VOICE_EN, "Blackjack"),
    "turn": (VOICE_KO, "당신의 차례입니다"),
    "fold": (VOICE_EN, "Fold"),
    "allin": (VOICE_EN, "All In"),
}


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key, (voice, line) in LINES.items():
        out = OUT_DIR / f"{key}.mp3"
        await edge_tts.Communicate(line, voice).save(str(out))
        print(f"wrote {out}")


if __name__ == "__main__":
    asyncio.run(main())
