import type { PoolClient } from "pg";
import { COIN_SCALE } from "@golden/contracts";
import { pool } from "../database/pool.js";
import { wageringService } from "./wagering-service.js";

export interface LedgerEntryInput {
  accountId: string;
  amountMinor: number;
}

export function assertBalancedEntries(entries: LedgerEntryInput[]): void {
  if (entries.length < 2 || entries.reduce((sum, entry) => sum + entry.amountMinor, 0) !== 0) {
    throw new Error("Ledger entries must balance to zero");
  }
}

export class WalletService {
  async getUserBalance(userId: string): Promise<number> {
    const result = await pool.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE kind='user' AND user_id=$1", [userId]);
    return Math.round(Number(result.rows[0]?.balance_minor ?? 0) / COIN_SCALE);
  }

  async accountIds(client: PoolClient, userId: string, roomId: string): Promise<{ user: string; room: string; house: string }> {
    const result = await client.query<{ id: string; kind: string; user_id: string | null; room_id: string | null }>(
      `SELECT id,kind,user_id,room_id FROM wallet_accounts
       WHERE (kind='user' AND user_id=$1) OR (kind='room' AND room_id=$2) OR kind='house'`,
      [userId, roomId],
    );
    const user = result.rows.find((row) => row.kind === "user")?.id;
    const room = result.rows.find((row) => row.kind === "room")?.id;
    const house = result.rows.find((row) => row.kind === "house")?.id;
    if (!user || !room || !house) throw new Error("Wallet account configuration is incomplete");
    return { user, room, house };
  }

  async transfer(senderId: string, recipientNickname: string, amountMinor: number, requestId: string): Promise<{ duplicate: boolean }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`transfer:${requestId}`]);
      const existing = await client.query<{ sender_id: string; recipient_id: string; amount_minor: string }>(
        "SELECT sender_id,recipient_id,amount_minor FROM wallet_transfers WHERE request_id=$1",
        [requestId],
      );
      if (existing.rows[0]) {
        const recipient = await client.query<{ id: string }>("SELECT id FROM users WHERE nickname=$1", [recipientNickname]);
        if (existing.rows[0].sender_id !== senderId || existing.rows[0].recipient_id !== recipient.rows[0]?.id || Number(existing.rows[0].amount_minor) !== amountMinor) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return { duplicate: true };
      }
      const recipient = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE nickname=$1 AND approved=true",
        [recipientNickname],
      );
      const recipientId = recipient.rows[0]?.id;
      if (!recipientId) throw new Error("RECIPIENT_NOT_FOUND");
      if (recipientId === senderId) throw new Error("RECIPIENT_SELF");
      const accounts = await client.query<{ id: string; user_id: string }>(
        "SELECT id,user_id FROM wallet_accounts WHERE kind='user' AND user_id=ANY($1::uuid[])",
        [[senderId, recipientId]],
      );
      const senderAccount = accounts.rows.find((row) => row.user_id === senderId)?.id;
      const recipientAccount = accounts.rows.find((row) => row.user_id === recipientId)?.id;
      if (!senderAccount || !recipientAccount) throw new Error("Wallet account configuration is incomplete");
      await this.postTransaction(client, {
        type: "USER_TRANSFER",
        idempotencyKey: `transfer:${requestId}`,
        referenceType: "transfer",
        referenceId: requestId,
        entries: [
          { accountId: senderAccount, amountMinor: -amountMinor },
          { accountId: recipientAccount, amountMinor },
        ],
        metadata: { senderId, recipientId },
      });
      await wageringService.assertWithdrawAllowed(client, senderId);
      await client.query(
        "INSERT INTO wallet_transfers (id,request_id,sender_id,recipient_id,amount_minor) VALUES ($1,$1,$2,$3,$4)",
        [requestId, senderId, recipientId, amountMinor],
      );
      await client.query("COMMIT");
      return { duplicate: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Returns who to notify, or null if the request was already decided (nothing changed, no notification needed). */
  async decideCashRequest(requestId: string, adminId: string, decision: "approved" | "rejected"): Promise<{ userId: string; requestType: "deposit" | "withdraw" } | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ user_id: string; request_type: "deposit" | "withdraw"; amount_minor: string; status: string }>(
        "SELECT user_id,request_type,amount_minor,status FROM cash_requests WHERE id=$1 FOR UPDATE",
        [requestId],
      );
      const row = request.rows[0];
      if (!row) throw new Error("CASH_REQUEST_NOT_FOUND");
      if (row.status !== "pending") {
        await client.query("COMMIT");
        return null;
      }
      if (decision === "approved") {
        const accounts = await client.query<{ id: string; kind: string }>(
          "SELECT id,kind FROM wallet_accounts WHERE kind='issuance' OR (kind='user' AND user_id=$1) ORDER BY id FOR UPDATE",
          [row.user_id],
        );
        const issuance = accounts.rows.find((account) => account.kind === "issuance")?.id;
        const user = accounts.rows.find((account) => account.kind === "user")?.id;
        if (!issuance || !user) throw new Error("Wallet account configuration is incomplete");
        const amountMinor = Number(row.amount_minor);
        await this.postTransaction(client, {
          type: row.request_type === "deposit" ? "DEPOSIT_APPROVED" : "WITHDRAW_APPROVED",
          idempotencyKey: `cash-request:${requestId}`,
          referenceType: "cash_request",
          referenceId: requestId,
          entries: row.request_type === "deposit"
            ? [{ accountId: issuance, amountMinor: -amountMinor }, { accountId: user, amountMinor }]
            : [{ accountId: user, amountMinor: -amountMinor }, { accountId: issuance, amountMinor }],
          metadata: { approvedBy: adminId, requestType: row.request_type },
        });
        if (row.request_type === "deposit") await wageringService.addDeposit(client, row.user_id, requestId, amountMinor);
        else await wageringService.assertWithdrawAllowed(client, row.user_id);
      }
      await client.query("UPDATE cash_requests SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1", [requestId, decision, adminId]);
      await client.query("COMMIT");
      return { userId: row.user_id, requestType: row.request_type };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * A direct admin correction to a user's balance — positive credits, negative debits.
   * Unlike a cash-request deposit this never touches wagering requirements: it's a manual
   * fix/grant, not a real-money-equivalent top-up that should come with rollover strings.
   */
  async adminAdjustBalance(adminId: string, userId: string, amountMinor: number, idempotencyKey: string): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await client.query<{ id: string; kind: string }>(
        "SELECT id,kind FROM wallet_accounts WHERE kind='issuance' OR (kind='user' AND user_id=$1) ORDER BY id FOR UPDATE",
        [userId],
      );
      const issuance = accounts.rows.find((account) => account.kind === "issuance")?.id;
      const user = accounts.rows.find((account) => account.kind === "user")?.id;
      if (!issuance || !user) throw new Error("Wallet account configuration is incomplete");
      await this.postTransaction(client, {
        type: "ADMIN_ADJUSTMENT",
        idempotencyKey,
        referenceType: "admin_adjustment",
        // ledger_transactions.reference_id is a real uuid column — idempotencyKey is a
        // prefixed string ("admin-adjustment:<uuid>"), not a uuid, and Postgres rejects it.
        // The adjusted user's id is already a valid uuid and is the natural reference here.
        referenceId: userId,
        entries: [
          { accountId: user, amountMinor },
          { accountId: issuance, amountMinor: -amountMinor },
        ],
        metadata: { adminId, userId },
      });
      const balance = await client.query<{ balance_minor: string }>("SELECT balance_minor FROM wallet_accounts WHERE id=$1", [user]);
      await client.query("COMMIT");
      return Number(balance.rows[0]!.balance_minor);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async postTransaction(
    client: PoolClient,
    input: {
      type: string;
      idempotencyKey: string;
      referenceType: string;
      referenceId: string;
      entries: LedgerEntryInput[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ duplicate: boolean }> {
    assertBalancedEntries(input.entries);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyKey]);
    const existing = await client.query<{ transaction_type: string; reference_type: string; reference_id: string }>(
      "SELECT transaction_type,reference_type,reference_id FROM ledger_transactions WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const transaction = existing.rows[0];
      if (transaction.transaction_type !== input.type || transaction.reference_type !== input.referenceType || transaction.reference_id !== input.referenceId) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return { duplicate: true };
    }

    const ids = [...new Set(input.entries.map((entry) => entry.accountId))].sort();
    const balances = await client.query<{ id: string; kind: string; balance_minor: string }>(
      "SELECT id,kind,balance_minor FROM wallet_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    if (balances.rowCount !== ids.length) throw new Error("A ledger account was not found");
    for (const account of balances.rows) {
      const delta = input.entries.filter((entry) => entry.accountId === account.id).reduce((sum, entry) => sum + entry.amountMinor, 0);
      if (account.kind !== "issuance" && Number(account.balance_minor) + delta < 0) throw new Error("INSUFFICIENT_BALANCE");
    }

    const transaction = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (transaction_type,idempotency_key,reference_type,reference_id,metadata)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.type, input.idempotencyKey, input.referenceType, input.referenceId, JSON.stringify(input.metadata ?? {})],
    );
    const transactionId = transaction.rows[0]!.id;
    for (const entry of input.entries) {
      await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,$3)", [transactionId, entry.accountId, entry.amountMinor]);
      await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor+$2,version=version+1 WHERE id=$1", [entry.accountId, entry.amountMinor]);
    }
    return { duplicate: false };
  }
}

export const walletService = new WalletService();
