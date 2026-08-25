import type { PoolClient } from "pg";
import { COIN_SCALE, type Card, type CasinoHoldemOutcome } from "@golden/contracts";
import {
  casinoHoldemBonusMultiplier,
  casinoHoldemCallMultiplier,
  dealerQualifies,
  evaluateBestHoldemHand,
  comparePokerHands,
  type PokerHandRank,
} from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { wageringService } from "../../wallet/wagering-service.js";

export interface CasinoHoldemSettlement {
  handId: string;
  balance: number;
  dealerCards: Card[];
  dealerQualified: boolean;
  playerHand: PokerHandRank | null;
  dealerHand: PokerHandRank | null;
  anteOutcome: CasinoHoldemOutcome;
  callOutcome: CasinoHoldemOutcome | null;
  bonusOutcome: CasinoHoldemOutcome | null;
  antePayoutMinor: number;
  callPayoutMinor: number;
  bonusPayoutMinor: number;
  /** win/lose profit for the winner feed — only set when the player nets a genuine profit. */
  profitMinor: number;
}

export class CasinoHoldemService {
  /** Posts the Ante (+ optional AA Bonus) from the player into the room escrow and opens the
   * hand row. Idempotent on requestId via the DB's UNIQUE(request_id) constraint. */
  async openHand(input: {
    requestId: string;
    roomId: string;
    userId: string;
    anteMinor: number;
    bonusMinor: number;
    playerCards: Card[];
    dealerCards: Card[];
    board: Card[];
  }): Promise<{ handId: string; balance: number }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>("SELECT id FROM casino_holdem_hands WHERE request_id=$1", [input.requestId]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return { handId: existing.rows[0]!.id, balance: await walletService.getUserBalance(input.userId) };
      }
      const accounts = await walletService.accountIds(client, input.userId, input.roomId);
      const stakeMinor = input.anteMinor + input.bonusMinor;
      await walletService.postTransaction(client, {
        type: "CASINO_HOLDEM_ANTE",
        idempotencyKey: `casino-holdem-ante:${input.requestId}`,
        referenceType: "casino_holdem_hand",
        referenceId: input.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -stakeMinor },
          { accountId: accounts.room, amountMinor: stakeMinor },
        ],
      });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO casino_holdem_hands (room_id,user_id,request_id,ante_minor,bonus_minor,player_cards,dealer_cards,board)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [input.roomId, input.userId, input.requestId, input.anteMinor, input.bonusMinor, JSON.stringify(input.playerCards), JSON.stringify(input.dealerCards), JSON.stringify(input.board)],
      );
      await client.query("COMMIT");
      return { handId: inserted.rows[0]!.id, balance: await walletService.getUserBalance(input.userId) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Folds the hand: Ante is forfeit, no Call was ever placed. The AA Bonus (if any) still
   * settles on its own — see settle() — since the full board was already dealt server-side. */
  async settleFold(handId: string, roomId: string, userId: string): Promise<CasinoHoldemSettlement> {
    return this.settle(handId, roomId, userId, { folded: true });
  }

  /** Calls the hand: posts the 2x-Ante Call stake, then reveals turn/river + dealer's hand and
   * settles. The full board and dealer hand are already fixed from openHand() — this only makes
   * the Call's chips real and unlocks the showdown. */
  async settleCall(input: { requestId: string; handId: string; roomId: string; userId: string; callMinor: number }): Promise<CasinoHoldemSettlement> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`casino-holdem-call:${input.requestId}`]);
      const existing = await client.query<{ call_minor: string }>("SELECT call_minor FROM casino_holdem_hands WHERE id=$1", [input.handId]);
      if (Number(existing.rows[0]?.call_minor ?? 0) > 0) {
        await client.query("COMMIT");
        return this.settle(input.handId, input.roomId, input.userId, { folded: false });
      }
      const accounts = await walletService.accountIds(client, input.userId, input.roomId);
      await walletService.postTransaction(client, {
        type: "CASINO_HOLDEM_CALL",
        idempotencyKey: `casino-holdem-call:${input.requestId}`,
        referenceType: "casino_holdem_hand",
        referenceId: input.handId,
        entries: [
          { accountId: accounts.user, amountMinor: -input.callMinor },
          { accountId: accounts.room, amountMinor: input.callMinor },
        ],
      });
      await client.query("UPDATE casino_holdem_hands SET call_minor=$2 WHERE id=$1", [input.handId, input.callMinor]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.settle(input.handId, input.roomId, input.userId, { folded: false });
  }

  /**
   * Resolves the hand and pays out. There is no shared pot the way PvP Hold'em has — the house
   * (via the room escrow) is the direct counterparty on every leg, same as Blackjack.
   */
  private async settle(handId: string, roomId: string, userId: string, { folded }: { folded: boolean }): Promise<CasinoHoldemSettlement> {
    const row = await pool.query<{
      ante_minor: string; bonus_minor: string; call_minor: string;
      player_cards: Card[]; dealer_cards: Card[]; board: Card[];
    }>(
      "SELECT ante_minor,bonus_minor,call_minor,player_cards,dealer_cards,board FROM casino_holdem_hands WHERE id=$1 AND user_id=$2",
      [handId, userId],
    );
    const hand = row.rows[0];
    if (!hand) throw new Error("HAND_NOT_FOUND");
    const anteMinor = Number(hand.ante_minor);
    const bonusMinor = Number(hand.bonus_minor);
    const callMinor = Number(hand.call_minor);

    let playerHand: PokerHandRank | null = null;
    let dealerHand: PokerHandRank | null = null;
    let dealerQualified = false;
    let anteOutcome: CasinoHoldemOutcome;
    let callOutcome: CasinoHoldemOutcome | null = null;
    let antePayoutMinor = 0;
    let callPayoutMinor = 0;

    if (folded) {
      anteOutcome = "fold";
    } else {
      playerHand = evaluateBestHoldemHand([...hand.player_cards, ...hand.board]);
      dealerHand = evaluateBestHoldemHand([...hand.dealer_cards, ...hand.board]);
      dealerQualified = dealerQualifies(dealerHand);
      if (!dealerQualified) {
        anteOutcome = "win";
        antePayoutMinor = anteMinor * 2;
        callOutcome = "push";
        callPayoutMinor = callMinor;
      } else {
        const comparison = comparePokerHands(playerHand, dealerHand);
        if (comparison > 0) {
          anteOutcome = "win";
          antePayoutMinor = anteMinor * 2;
          callOutcome = "win";
          callPayoutMinor = callMinor + callMinor * casinoHoldemCallMultiplier(playerHand);
        } else if (comparison === 0) {
          anteOutcome = "push";
          antePayoutMinor = anteMinor;
          callOutcome = "push";
          callPayoutMinor = callMinor;
        } else {
          anteOutcome = "lose";
          callOutcome = "lose";
        }
      }
    }

    // AA Bonus settles on the player's own final hand alone, independent of fold/call/dealer.
    // hand.board is always the *full* 5-card board — dealt and persisted in full at openHand()
    // even though the client only sees the flop until a Call — so the Bonus judges the true
    // final hand even when the player folds without ever seeing turn/river themselves.
    let bonusOutcome: CasinoHoldemOutcome | null = null;
    let bonusPayoutMinor = 0;
    if (bonusMinor > 0) {
      const finalHand = playerHand ?? evaluateBestHoldemHand([...hand.player_cards, ...hand.board]);
      const multiplier = casinoHoldemBonusMultiplier(finalHand);
      if (multiplier > 0) {
        bonusOutcome = "win";
        bonusPayoutMinor = bonusMinor + bonusMinor * multiplier;
      } else {
        bonusOutcome = "lose";
      }
    }

    const totalStakeMinor = anteMinor + bonusMinor + callMinor;
    const totalPayoutMinor = antePayoutMinor + bonusPayoutMinor + callPayoutMinor;
    const houseDeltaMinor = totalStakeMinor - totalPayoutMinor;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await walletService.accountIds(client, userId, roomId);
      const entries: Array<{ accountId: string; amountMinor: number }> = [{ accountId: accounts.room, amountMinor: -totalStakeMinor }];
      if (totalPayoutMinor > 0) entries.push({ accountId: accounts.user, amountMinor: totalPayoutMinor });
      if (houseDeltaMinor !== 0) entries.push({ accountId: accounts.house, amountMinor: houseDeltaMinor });
      await walletService.postTransaction(client, {
        type: "CASINO_HOLDEM_SETTLED",
        idempotencyKey: `casino-holdem-settle:${handId}`,
        referenceType: "casino_holdem_hand",
        referenceId: handId,
        entries,
        metadata: { anteOutcome, callOutcome, bonusOutcome, dealerQualified },
      });
      await client.query(
        `UPDATE casino_holdem_hands SET
           decision=$2, dealer_qualified=$3, ante_outcome=$4, call_outcome=$5, bonus_outcome=$6,
           ante_payout_minor=$7, call_payout_minor=$8, bonus_payout_minor=$9, settled_at=now()
         WHERE id=$1`,
        [handId, folded ? "fold" : "call", dealerQualified, anteOutcome, callOutcome, bonusOutcome, antePayoutMinor, callPayoutMinor, bonusPayoutMinor],
      );
      // Wagering credit only on genuine action against the house (folding forfeits instantly,
      // there's no realistic collusion angle to gate here the way PvP rake is gated).
      if (totalStakeMinor > 0) await wageringService.applyEligibleWager(client, userId, "casino_holdem_wager", handId, totalStakeMinor);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      handId,
      balance: await walletService.getUserBalance(userId),
      dealerCards: hand.dealer_cards,
      dealerQualified,
      playerHand,
      dealerHand,
      anteOutcome,
      callOutcome,
      bonusOutcome,
      antePayoutMinor,
      callPayoutMinor,
      bonusPayoutMinor,
      profitMinor: totalPayoutMinor - totalStakeMinor,
    };
  }
}

export const casinoHoldemService = new CasinoHoldemService();
export { COIN_SCALE };
