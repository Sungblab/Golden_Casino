import type { BaccaratBetChoice, Card } from "@golden/contracts";
import { Shoe } from "./shoe.js";

export interface BaccaratResult {
  playerCards: Card[];
  bankerCards: Card[];
  playerScore: number;
  bankerScore: number;
  result: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
}

export function cardValue(card: Card): number {
  if (card.rank === "A") return 1;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 0;
  return Number(card.rank);
}

export function handScore(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

export function shouldBankerDraw(score: number, playerThirdCard?: Card): boolean {
  if (!playerThirdCard) return score <= 5;
  const third = cardValue(playerThirdCard);
  if (score <= 2) return true;
  if (score === 3) return third !== 8;
  if (score === 4) return third >= 2 && third <= 7;
  if (score === 5) return third >= 4 && third <= 7;
  if (score === 6) return third === 6 || third === 7;
  return false;
}

export function playBaccaratRound(shoe: Shoe): BaccaratResult {
  // Punto Banco is dealt in table order: Player, Banker, Player, Banker.
  const playerCards = [shoe.draw()];
  const bankerCards = [shoe.draw()];
  playerCards.push(shoe.draw());
  bankerCards.push(shoe.draw());
  const playerPair = playerCards[0]!.rank === playerCards[1]!.rank;
  const bankerPair = bankerCards[0]!.rank === bankerCards[1]!.rank;
  const initialPlayerScore = handScore(playerCards);
  const initialBankerScore = handScore(bankerCards);

  if (initialPlayerScore < 8 && initialBankerScore < 8) {
    let playerThirdCard: Card | undefined;
    if (initialPlayerScore <= 5) {
      playerThirdCard = shoe.draw();
      playerCards.push(playerThirdCard);
    }
    if (shouldBankerDraw(initialBankerScore, playerThirdCard)) bankerCards.push(shoe.draw());
  }

  const playerScore = handScore(playerCards);
  const bankerScore = handScore(bankerCards);
  return {
    playerCards,
    bankerCards,
    playerScore,
    bankerScore,
    result: playerScore === bankerScore ? "tie" : playerScore > bankerScore ? "player" : "banker",
    playerPair,
    bankerPair,
  };
}

export function payoutMultiplierHundredths(choice: BaccaratBetChoice, result: BaccaratResult): number {
  if (choice === "player" && result.result === "tie") return 100;
  if (choice === "banker" && result.result === "tie") return 100;
  if (choice === "player" && result.result === "player") return 200;
  if (choice === "banker" && result.result === "banker") return 195;
  if (choice === "tie" && result.result === "tie") return 900;
  if (choice === "player_pair" && result.playerPair) return 1200;
  if (choice === "banker_pair" && result.bankerPair) return 1200;
  return 0;
}

/**
 * Total returned to the player, stake included. `unit` is the smallest public
 * chip unit (100 for the API's minor-unit ledger). Commission is rounded to
 * the nearest whole chip so a baccarat round can never create fractional coins.
 */
export function payoutForBaccaratBet(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  stake: number,
  unit = 1,
): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Baccarat stake must be a whole number of settlement units");
  }
  const multiplier = payoutMultiplierHundredths(choice, result);
  if (multiplier === 0) return 0;
  if (multiplier === 100) return stake;
  const stakeUnits = stake / unit;
  const profitUnits = Math.round((stakeUnits * (multiplier - 100)) / 100);
  return (stakeUnits + profitUnits) * unit;
}

