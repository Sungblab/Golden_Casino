import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const rooms = [
  ["10000000-0000-4000-8000-000000000001", "baccarat", "baccarat-rookie", "Rookie Baccarat", 1, 10, true],
  ["10000000-0000-4000-8000-000000000002", "baccarat", "baccarat-standard", "Standard Baccarat", 10, 50, true],
  ["10000000-0000-4000-8000-000000000003", "baccarat", "baccarat-high", "High Roller Baccarat", 50, 200, true],
  ["20000000-0000-4000-8000-000000000001", "blackjack", "blackjack-rookie", "Rookie Blackjack", 1, 10, true],
  ["20000000-0000-4000-8000-000000000002", "blackjack", "blackjack-standard", "Standard Blackjack", 10, 50, true],
  ["20000000-0000-4000-8000-000000000003", "blackjack", "blackjack-high", "High Roller Blackjack", 50, 200, true],
] as const;

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const room of rooms) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,enabled=EXCLUDED.enabled`,
      [...room],
    );
    await client.query(
      `INSERT INTO wallet_accounts (kind, room_id) VALUES ('room',$1)
       ON CONFLICT DO NOTHING`,
      [room[0]],
    );
  }

  const passwordHash = await bcrypt.hash("demo1234", 12);
  const userResult = await client.query<{ id: string }>(
    `INSERT INTO users (id, username, password_hash, role, approved)
     VALUES ('30000000-0000-4000-8000-000000000001','demo',$1,'user',true)
     ON CONFLICT (username) DO UPDATE SET approved=true
     RETURNING id`,
    [passwordHash],
  );
  const userId = userResult.rows[0]!.id;
  const adminPasswordHash = await bcrypt.hash("admin1234", 12);
  await client.query(
    `INSERT INTO users (id, username, password_hash, role, approved)
     VALUES ('30000000-0000-4000-8000-000000000002','admin',$1,'admin',true)
     ON CONFLICT (username) DO UPDATE SET approved=true`,
    [adminPasswordHash],
  );
  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('issuance') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('house') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO wallet_accounts (kind, user_id) VALUES ('user',$1) ON CONFLICT DO NOTHING", [userId]);

  const openingExists = await client.query("SELECT 1 FROM ledger_transactions WHERE idempotency_key='seed:demo-and-house:v1'");
  if (openingExists.rowCount === 0) {
    const accounts = await client.query<{ id: string; kind: string; user_id: string | null }>(
      "SELECT id,kind,user_id FROM wallet_accounts WHERE kind IN ('issuance','house') OR user_id=$1 FOR UPDATE",
      [userId],
    );
    const issuance = accounts.rows.find((row) => row.kind === "issuance")!;
    const house = accounts.rows.find((row) => row.kind === "house")!;
    const user = accounts.rows.find((row) => row.user_id === userId)!;
    const houseAmount = 100_000_000 * 100;
    const userAmount = 1_250 * 100;
    const tx = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (transaction_type,idempotency_key,reference_type)
       VALUES ('OPENING_BALANCE','seed:demo-and-house:v1','seed') RETURNING id`,
    );
    const txId = tx.rows[0]!.id;
    for (const [accountId, amount] of [[issuance.id, -(houseAmount + userAmount)], [house.id, houseAmount], [user.id, userAmount]] as const) {
      await client.query("INSERT INTO ledger_entries (transaction_id,account_id,amount_minor) VALUES ($1,$2,$3)", [txId, accountId, amount]);
      await client.query("UPDATE wallet_accounts SET balance_minor=balance_minor+$2,version=version+1 WHERE id=$1", [accountId, amount]);
    }
  }
  await client.query("COMMIT");
  console.log("Seed complete: demo / demo1234");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
