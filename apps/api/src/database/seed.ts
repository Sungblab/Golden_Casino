import { pool } from "./pool.js";

// Reference framing for these limits: 1 coin ≈ 1,000 KRW. Rookie tops out around "lose a coffee",
// Standard around "lose a dinner", High Roller is the real-money room. Side bet caps (Player/Banker
// Pair at 11:1, Suited Tie at 50:1) are set far below the room's main limit on purpose — a payout
// multiplier turns an ordinary-looking max bet into disproportionate house exposure, same as any
// real casino's side-bet limits. Tie is not treated as a side bet (see bet-service.ts).
const rooms = [
  // id, game_type, code, name, min_bet, max_bet, side_bet_max
  ["10000000-0000-4000-8000-000000000001", "baccarat", "baccarat-rookie", "Rookie Baccarat", 1, 20, 5],
  ["10000000-0000-4000-8000-000000000002", "baccarat", "baccarat-standard", "Standard Baccarat", 10, 200, 40],
  ["10000000-0000-4000-8000-000000000003", "baccarat", "baccarat-high", "High Roller Baccarat", 100, 5_000, 500],
  ["11000000-0000-4000-8000-000000000001", "lightning_baccarat", "lightning-baccarat", "Lightning Baccarat", 10, 1_000, 100],

  ["20000000-0000-4000-8000-000000000001", "blackjack", "blackjack-rookie", "Rookie Blackjack", 1, 20, null],
  ["20000000-0000-4000-8000-000000000002", "blackjack", "blackjack-standard", "Standard Blackjack", 10, 200, null],
  ["20000000-0000-4000-8000-000000000003", "blackjack", "blackjack-high", "High Roller Blackjack", 100, 5_000, null],
  ["21000000-0000-4000-8000-000000000001", "lightning_blackjack", "lightning-blackjack", "Lightning Blackjack", 10, 1_000, null],

  ["12000000-0000-4000-8000-000000000002", "dragon_tiger", "dragon-tiger-rookie", "Rookie Dragon Tiger", 1, 20, 5],
  ["12000000-0000-4000-8000-000000000001", "dragon_tiger", "dragon-tiger-standard", "Standard Dragon Tiger", 10, 200, 40],
  ["12000000-0000-4000-8000-000000000003", "dragon_tiger", "dragon-tiger-high", "High Roller Dragon Tiger", 100, 5_000, 500],

  ["30000000-0000-4000-8000-000000000010", "holdem", "holdem-micro", "Micro Hold'em 6-Max", 1, 100, null],
  ["30000000-0000-4000-8000-000000000011", "holdem", "holdem-standard", "Standard Hold'em 6-Max", 10, 1_000, null],
  ["30000000-0000-4000-8000-000000000012", "holdem", "holdem-high", "High Roller Hold'em 6-Max", 50, 5_000, null],

  ["40000000-0000-4000-8000-000000000001", "sutda", "sutda-rookie", "Rookie Sutda 2–6", 1, 100, null],
  ["40000000-0000-4000-8000-000000000002", "sutda", "sutda-standard", "Standard Sutda 2–6", 10, 1_000, null],
  ["40000000-0000-4000-8000-000000000003", "sutda", "sutda-high", "High Roller Sutda 2–6", 50, 5_000, null],
] as const;

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const room of rooms) {
    await client.query(
      `INSERT INTO game_rooms (id, game_type, code, name, min_bet, max_bet, side_bet_max, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (id) DO UPDATE SET game_type=EXCLUDED.game_type,name=EXCLUDED.name,min_bet=EXCLUDED.min_bet,max_bet=EXCLUDED.max_bet,side_bet_max=EXCLUDED.side_bet_max,enabled=EXCLUDED.enabled`,
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
