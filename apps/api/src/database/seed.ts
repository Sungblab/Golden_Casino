import { pool } from "./pool.js";

const rooms = [
  ["10000000-0000-4000-8000-000000000001", "baccarat", "baccarat-rookie", "Rookie Baccarat", 1, 50, true],
  ["10000000-0000-4000-8000-000000000002", "baccarat", "baccarat-standard", "Standard Baccarat", 10, 100, true],
  ["10000000-0000-4000-8000-000000000003", "baccarat", "baccarat-high", "High Roller Baccarat", 50, 500, true],
  ["20000000-0000-4000-8000-000000000001", "blackjack", "blackjack-rookie", "Rookie Blackjack", 1, 50, true],
  ["20000000-0000-4000-8000-000000000002", "blackjack", "blackjack-standard", "Standard Blackjack", 10, 100, true],
  ["20000000-0000-4000-8000-000000000003", "blackjack", "blackjack-high", "High Roller Blackjack", 50, 500, true],
  ["11000000-0000-4000-8000-000000000001", "lightning_baccarat", "lightning-baccarat", "Lightning Baccarat", 5, 500, true],
  ["12000000-0000-4000-8000-000000000001", "dragon_tiger", "dragon-tiger", "Dragon Tiger", 1, 500, true],
  ["21000000-0000-4000-8000-000000000001", "lightning_blackjack", "lightning-blackjack", "Lightning Blackjack", 5, 500, true],
  ["30000000-0000-4000-8000-000000000010", "holdem", "holdem-micro", "Micro Hold'em 6-Max", 1, 100, true],
  ["30000000-0000-4000-8000-000000000011", "holdem", "holdem-standard", "Standard Hold'em 6-Max", 10, 1000, true],
  ["30000000-0000-4000-8000-000000000012", "holdem", "holdem-high", "High Roller Hold'em 6-Max", 50, 5000, true],
] as const;

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const room of rooms) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET game_type=EXCLUDED.game_type,name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,enabled=EXCLUDED.enabled`,
      [...room],
    );
    await client.query(
      `INSERT INTO wallet_accounts (kind, room_id) VALUES ('room',$1)
       ON CONFLICT DO NOTHING`,
      [room[0]],
    );
  }

  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('issuance') ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO wallet_accounts (kind) VALUES ('house') ON CONFLICT DO NOTHING");
  await client.query("COMMIT");
  console.log("Seed complete: game rooms and system wallets only; no users created.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
