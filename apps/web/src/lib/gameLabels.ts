import type { GameType } from "@golden/contracts";

/** Human-readable name for every GameType, used on the game history page's per-game breakdown. */
export const GAME_TYPE_LABEL: Record<GameType, string> = {
  baccarat: "바카라",
  lightning_baccarat: "라이트닝 바카라",
  dragon_tiger: "드래곤 타이거",
  blackjack: "블랙잭",
  lightning_blackjack: "라이트닝 블랙잭",
  holdem: "홀덤",
  sutda: "섯다",
};

export const OUTCOME_LABEL: Record<string, string> = {
  win: "승리",
  lose: "패배",
  push: "무승부",
  blackjack: "블랙잭 승리",
  surrender: "서렌더",
};
