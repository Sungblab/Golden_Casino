export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(40) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  approved boolean NOT NULL DEFAULT true,
  legacy_mongo_id varchar(40) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nickname: the display name shown across chat/game surfaces, distinct from the
-- login username. Backfilled from username for pre-existing accounts so the
-- NOT NULL/UNIQUE constraints can apply uniformly going forward.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname varchar(20);
UPDATE users SET nickname = username WHERE nickname IS NULL;
ALTER TABLE users ALTER COLUMN nickname SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_unique ON users(nickname);
-- New accounts now go through self-service signup and start unapproved until
-- an admin reviews them; existing rows keep whatever value they already had.
ALTER TABLE users ALTER COLUMN approved SET DEFAULT false;

-- Soft delete: hard-deleting a user is blocked by ON DELETE RESTRICT the moment they've
-- placed a bet, sent a chat message, or touched cash/transfers — which is every real
-- account. Admin "탈퇴 처리" instead anonymizes the login identity and marks deleted_at,
-- keeping every ledger/wager/chat row intact for audit while approved=false permanently
-- blocks login and the admin user list filters the row out.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type varchar(30) NOT NULL CHECK (game_type IN ('baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','casino_holdem','sutda')),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(80) NOT NULL,
  min_bet integer NOT NULL CHECK (min_bet > 0),
  max_bet integer NOT NULL CHECK (max_bet >= min_bet),
  -- Separate, lower cap for high-payout proposition bets (Baccarat Player/Banker Pair at 11:1,
  -- Dragon Tiger Suited Tie at 50:1). NULL means the room has no side bets, or none narrower than
  -- max_bet — every real casino caps these far below the main table limit precisely because the
  -- payout multiplier turns an ordinary-looking max bet into disproportionate house exposure.
  side_bet_max integer CHECK (side_bet_max IS NULL OR (side_bet_max > 0 AND side_bet_max <= max_bet)),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS side_bet_max integer;
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_side_bet_max_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_side_bet_max_check
  CHECK (side_bet_max IS NULL OR (side_bet_max > 0 AND side_bet_max <= max_bet));

-- Lets an admin clear a table's visible road/scoreboard (Baccarat, Dragon Tiger) without
-- touching the underlying round/wager history those numbers are audited from — rounds up to
-- and including this round_number are simply excluded when the road is rebuilt from game_rounds.
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS road_reset_after_round bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL CHECK (kind IN ('user', 'house', 'room', 'issuance')),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  room_id uuid REFERENCES game_rooms(id) ON DELETE RESTRICT,
  balance_minor bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_owner_shape CHECK (
    (kind = 'user' AND user_id IS NOT NULL AND room_id IS NULL) OR
    (kind = 'room' AND room_id IS NOT NULL AND user_id IS NULL) OR
    (kind IN ('house', 'issuance') AND user_id IS NULL AND room_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS one_wallet_per_user ON wallet_accounts(user_id) WHERE kind = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS one_wallet_per_room ON wallet_accounts(room_id) WHERE kind = 'room';
CREATE UNIQUE INDEX IF NOT EXISTS one_house_wallet ON wallet_accounts(kind) WHERE kind = 'house';
CREATE UNIQUE INDEX IF NOT EXISTS one_issuance_wallet ON wallet_accounts(kind) WHERE kind = 'issuance';

ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('baccarat','lightning_baccarat','dragon_tiger','blackjack','lightning_blackjack','holdem','casino_holdem','sutda'));

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type varchar(40) NOT NULL,
  idempotency_key varchar(120) NOT NULL UNIQUE,
  reference_type varchar(40),
  reference_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account_id, id DESC);

CREATE OR REPLACE FUNCTION enforce_balanced_ledger_transaction() RETURNS trigger AS $$
DECLARE
  affected_transaction uuid;
  transaction_sum bigint;
BEGIN
  affected_transaction := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT COALESCE(SUM(amount_minor), 0) INTO transaction_sum
  FROM ledger_entries WHERE transaction_id = affected_transaction;
  IF transaction_sum <> 0 THEN
    RAISE EXCEPTION 'Unbalanced ledger transaction %: %', affected_transaction, transaction_sum;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_balanced_ledger_transaction();

CREATE OR REPLACE FUNCTION enforce_wallet_balance_cache() RETURNS trigger AS $$
DECLARE
  affected_account uuid;
  cached_balance bigint;
  ledger_balance bigint;
BEGIN
  IF TG_TABLE_NAME = 'wallet_accounts' THEN
    affected_account := COALESCE(NEW.id, OLD.id);
  ELSE
    affected_account := COALESCE(NEW.account_id, OLD.account_id);
  END IF;
  SELECT balance_minor INTO cached_balance FROM wallet_accounts WHERE id = affected_account;
  SELECT COALESCE(SUM(amount_minor), 0) INTO ledger_balance FROM ledger_entries WHERE account_id = affected_account;
  IF cached_balance IS NOT NULL AND cached_balance <> ledger_balance THEN
    RAISE EXCEPTION 'Wallet balance cache mismatch for %: cache %, ledger %', affected_account, cached_balance, ledger_balance;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_match_wallet ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_match_wallet
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_wallet_balance_cache();

DROP TRIGGER IF EXISTS wallet_balance_matches_ledger ON wallet_accounts;
CREATE CONSTRAINT TRIGGER wallet_balance_matches_ledger
AFTER INSERT OR UPDATE OF balance_minor ON wallet_accounts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_wallet_balance_cache();

-- One-time conversion from the former fractional-coin policy. Every non-house
-- account is moved to a whole coin; user balances round up so this migration
-- never removes value from a player. The house receives the exact balancing
-- entry, preserving the double-entry ledger invariant.
DO $whole_coin_normalization$
DECLARE
  normalization_id uuid;
  house_account_id uuid;
  account_record record;
  adjustment_minor bigint;
  total_adjustment_minor bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'normalize-whole-coins:v1') THEN
    SELECT id INTO house_account_id FROM wallet_accounts WHERE kind = 'house' LIMIT 1;
    IF house_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM wallet_accounts WHERE kind <> 'house' AND MOD(balance_minor, 100) <> 0
    ) THEN
      normalization_id := gen_random_uuid();
      INSERT INTO ledger_transactions (id, transaction_type, idempotency_key, reference_type, metadata)
      VALUES (normalization_id, 'WHOLE_COIN_NORMALIZATION', 'normalize-whole-coins:v1', 'wallet_migration', '{"policy":"round-users-up"}'::jsonb);

      FOR account_record IN
        SELECT id, kind, balance_minor
        FROM wallet_accounts
        WHERE kind <> 'house' AND MOD(balance_minor, 100) <> 0
        ORDER BY id
        FOR UPDATE
      LOOP
        adjustment_minor := CASE
          WHEN account_record.kind = 'user'
            THEN (CEIL(account_record.balance_minor::numeric / 100) * 100)::bigint - account_record.balance_minor
          ELSE (ROUND(account_record.balance_minor::numeric / 100) * 100)::bigint - account_record.balance_minor
        END;
        IF adjustment_minor <> 0 THEN
          INSERT INTO ledger_entries (transaction_id, account_id, amount_minor)
          VALUES (normalization_id, account_record.id, adjustment_minor);
          UPDATE wallet_accounts
          SET balance_minor = balance_minor + adjustment_minor, version = version + 1
          WHERE id = account_record.id;
          total_adjustment_minor := total_adjustment_minor + adjustment_minor;
        END IF;
      END LOOP;

      IF total_adjustment_minor <> 0 THEN
        INSERT INTO ledger_entries (transaction_id, account_id, amount_minor)
        VALUES (normalization_id, house_account_id, -total_adjustment_minor);
        UPDATE wallet_accounts
        SET balance_minor = balance_minor - total_adjustment_minor, version = version + 1
        WHERE id = house_account_id;
      END IF;
    END IF;
  END IF;
END
$whole_coin_normalization$;

CREATE TABLE IF NOT EXISTS game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  round_number bigint NOT NULL,
  phase varchar(20) NOT NULL,
  result varchar(20),
  player_cards jsonb,
  banker_cards jsonb,
  player_score smallint,
  banker_score smallint,
  player_pair boolean NOT NULL DEFAULT false,
  banker_pair boolean NOT NULL DEFAULT false,
  rules_version varchar(20) NOT NULL DEFAULT 'baccarat-v1',
  result_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(room_id, round_number)
);
UPDATE game_rounds SET settled_at=started_at WHERE phase='RESULT' AND settled_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_round_per_room ON game_rounds(room_id) WHERE settled_at IS NULL;

CREATE TABLE IF NOT EXISTS wagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  choice varchar(30) NOT NULL CHECK (choice IN ('player','banker','tie','player_pair','banker_pair','dragon','tiger','suited_tie')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  status varchar(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','settled','cancelled')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS wagers_round_idx ON wagers(round_id);
CREATE INDEX IF NOT EXISTS wagers_user_idx ON wagers(user_id, placed_at DESC);
ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS result_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE wagers ADD COLUMN IF NOT EXISTS fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0);
ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_choice_check
  CHECK (choice IN ('player','banker','tie','player_pair','banker_pair','dragon','tiger','suited_tie'));

-- Hold'em PvP: one row per seated player per hand (game_rounds row). There is
-- no house counterparty, so amount_minor accumulates into the room escrow
-- account across the whole hand and settle() splits it back out to winners
-- (minus rake) instead of to the house on a loss.
CREATE TABLE IF NOT EXISTS holdem_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 9),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  folded boolean NOT NULL DEFAULT false,
  all_in boolean NOT NULL DEFAULT false,
  hole_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS holdem_contributions_round_idx ON holdem_contributions(round_id);
CREATE INDEX IF NOT EXISTS holdem_contributions_user_idx ON holdem_contributions(user_id, placed_at DESC);

-- Casino Hold'em: player-vs-house, one private hand per user. Unlike holdem_contributions
-- (PvP, tied to a shared game_rounds row) each hand here is fully self-contained — there is
-- no shared round to join since every player's hand is independent, dealt and settled on its
-- own. The id column doubles as the hand id the client references when calling/folding.
CREATE TABLE IF NOT EXISTS casino_holdem_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  ante_minor bigint NOT NULL CHECK (ante_minor > 0),
  bonus_minor bigint NOT NULL DEFAULT 0 CHECK (bonus_minor >= 0),
  call_minor bigint NOT NULL DEFAULT 0 CHECK (call_minor >= 0),
  player_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  dealer_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  board jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision varchar(10) CHECK (decision IN ('call','fold')),
  dealer_qualified boolean,
  ante_outcome varchar(10) CHECK (ante_outcome IN ('win','lose','push','fold')),
  call_outcome varchar(10) CHECK (call_outcome IN ('win','lose','push')),
  bonus_outcome varchar(10) CHECK (bonus_outcome IN ('win','lose')),
  ante_payout_minor bigint,
  call_payout_minor bigint,
  bonus_payout_minor bigint,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS casino_holdem_hands_user_idx ON casino_holdem_hands(user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS sutda_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES game_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_number smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 6),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  folded boolean NOT NULL DEFAULT false,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS sutda_contributions_round_idx ON sutda_contributions(round_id);
CREATE INDEX IF NOT EXISTS sutda_contributions_user_idx ON sutda_contributions(user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS blackjack_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  round_number bigint NOT NULL,
  phase varchar(20) NOT NULL,
  dealer_cards jsonb,
  dealer_score smallint,
  started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(room_id, round_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_blackjack_round_per_room ON blackjack_rounds(room_id) WHERE settled_at IS NULL;

CREATE TABLE IF NOT EXISTS blackjack_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES blackjack_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  seat_number smallint CHECK (seat_number BETWEEN 1 AND 7),
  hand_index smallint NOT NULL DEFAULT 0 CHECK (hand_index BETWEEN 0 AND 3),
  parent_hand_id uuid,
  from_split boolean NOT NULL DEFAULT false,
  split_aces boolean NOT NULL DEFAULT false,
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  lightning_fee_minor bigint NOT NULL DEFAULT 0 CHECK (lightning_fee_minor >= 0),
  lightning_multiplier smallint NOT NULL DEFAULT 1 CHECK (lightning_multiplier IN (1,2,5,8,10,15,20,25)),
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'playing' CHECK (status IN ('playing','stand','bust','blackjack','doubled','surrendered')),
  outcome varchar(20) CHECK (outcome IN ('win','lose','push','blackjack','surrender')),
  payout_minor bigint,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id, hand_index)
);
CREATE INDEX IF NOT EXISTS blackjack_hands_round_idx ON blackjack_hands(round_id);
CREATE INDEX IF NOT EXISTS blackjack_hands_user_idx ON blackjack_hands(user_id, placed_at DESC);
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS seat_number smallint CHECK (seat_number BETWEEN 1 AND 7);
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS hand_index smallint NOT NULL DEFAULT 0 CHECK (hand_index BETWEEN 0 AND 3);
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS parent_hand_id uuid;
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS from_split boolean NOT NULL DEFAULT false;
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS split_aces boolean NOT NULL DEFAULT false;
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS lightning_fee_minor bigint NOT NULL DEFAULT 0 CHECK (lightning_fee_minor >= 0);
ALTER TABLE blackjack_hands ADD COLUMN IF NOT EXISTS lightning_multiplier smallint NOT NULL DEFAULT 1 CHECK (lightning_multiplier IN (1,2,5,8,10,15,20,25));
ALTER TABLE blackjack_hands DROP CONSTRAINT IF EXISTS blackjack_hands_round_id_user_id_key;
ALTER TABLE blackjack_hands DROP CONSTRAINT IF EXISTS blackjack_hands_status_check;
ALTER TABLE blackjack_hands ADD CONSTRAINT blackjack_hands_status_check CHECK (status IN ('playing','stand','bust','blackjack','doubled','surrendered'));
ALTER TABLE blackjack_hands DROP CONSTRAINT IF EXISTS blackjack_hands_outcome_check;
ALTER TABLE blackjack_hands ADD CONSTRAINT blackjack_hands_outcome_check CHECK (outcome IN ('win','lose','push','blackjack','surrender'));
DROP INDEX IF EXISTS blackjack_hands_round_seat_idx;
CREATE UNIQUE INDEX IF NOT EXISTS blackjack_hands_round_user_index_idx ON blackjack_hands(round_id,user_id,hand_index);
CREATE UNIQUE INDEX IF NOT EXISTS blackjack_hands_round_seat_hand_idx ON blackjack_hands(round_id,seat_number,hand_index) WHERE seat_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS blackjack_bet_increments (
  request_id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES blackjack_hands(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  placed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blackjack_bet_increments_hand_idx ON blackjack_bet_increments(hand_id, placed_at);

CREATE TABLE IF NOT EXISTS blackjack_behind_bets (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES blackjack_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_hand_id uuid NOT NULL REFERENCES blackjack_hands(id) ON DELETE RESTRICT,
  target_seat smallint NOT NULL CHECK (target_seat BETWEEN 1 AND 7),
  request_id uuid NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push','blackjack','surrender')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id, target_seat)
);
CREATE INDEX IF NOT EXISTS blackjack_behind_round_idx ON blackjack_behind_bets(round_id);
CREATE INDEX IF NOT EXISTS blackjack_behind_user_idx ON blackjack_behind_bets(user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS blackjack_behind_target_idx ON blackjack_behind_bets(target_hand_id);
ALTER TABLE blackjack_behind_bets DROP CONSTRAINT IF EXISTS blackjack_behind_bets_outcome_check;
ALTER TABLE blackjack_behind_bets ADD CONSTRAINT blackjack_behind_bets_outcome_check CHECK (outcome IN ('win','lose','push','blackjack','surrender'));

CREATE TABLE IF NOT EXISTS blackjack_behind_bet_increments (
  request_id uuid PRIMARY KEY,
  bet_id uuid NOT NULL REFERENCES blackjack_behind_bets(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  placed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blackjack_behind_bet_increments_bet_idx ON blackjack_behind_bet_increments(bet_id, placed_at);

CREATE TABLE IF NOT EXISTS blackjack_insurance_bets (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES blackjack_rounds(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hand_id uuid NOT NULL REFERENCES blackjack_hands(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id,user_id)
);
CREATE INDEX IF NOT EXISTS blackjack_insurance_round_idx ON blackjack_insurance_bets(round_id);

CREATE TABLE IF NOT EXISTS cash_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type varchar(20) NOT NULL CHECK (request_type IN ('deposit','withdraw')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_requests_user_idx ON cash_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_requests_pending_idx ON cash_requests(status, created_at DESC);

-- A deposit creates a 1x wagering requirement. Progress only comes from
-- qualifying, settled wagers recorded after that requirement exists.
CREATE TABLE IF NOT EXISTS wagering_requirements (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  cycle_required_minor bigint NOT NULL DEFAULT 0 CHECK (cycle_required_minor >= 0),
  cycle_completed_minor bigint NOT NULL DEFAULT 0 CHECK (cycle_completed_minor >= 0),
  remaining_minor bigint NOT NULL DEFAULT 0 CHECK (remaining_minor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wagering_progress_balanced CHECK (cycle_required_minor = cycle_completed_minor + remaining_minor)
);

CREATE TABLE IF NOT EXISTS blackjack_lightning_awards (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  multiplier smallint NOT NULL CHECK (multiplier IN (2,5,8,10,15,20,25)),
  source_round_id uuid NOT NULL REFERENCES blackjack_rounds(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wagering_progress_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_type varchar(40) NOT NULL CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','holdem_rake','casino_holdem_wager','sutda_rake')),
  source_id uuid NOT NULL,
  qualifying_amount_minor bigint NOT NULL CHECK (qualifying_amount_minor > 0),
  credited_amount_minor bigint NOT NULL DEFAULT 0 CHECK (credited_amount_minor >= 0 AND credited_amount_minor <= qualifying_amount_minor),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS wagering_progress_user_idx ON wagering_progress_events(user_id, id DESC);
-- dragon_tiger_wager, holdem_rake, and sutda_rake were each added to the application's
-- WageringSourceType union after this table first shipped; the CHECK constraint never followed,
-- so every non-push settlement in that game was silently crashing settlement mid-transaction.
ALTER TABLE wagering_progress_events DROP CONSTRAINT IF EXISTS wagering_progress_events_source_type_check;
ALTER TABLE wagering_progress_events ADD CONSTRAINT wagering_progress_events_source_type_check
  CHECK (source_type IN ('cash_deposit','baccarat_wager','dragon_tiger_wager','blackjack_hand','blackjack_behind','blackjack_insurance','holdem_rake','casino_holdem_wager','sutda_rake'));

CREATE TABLE IF NOT EXISTS wallet_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_users_differ CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS wallet_transfers_sender_idx ON wallet_transfers(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_transfers_recipient_idx ON wallet_transfers(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES game_rooms(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES support_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message varchar(500) NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
  highlighted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_scope CHECK (
    (room_id IS NOT NULL AND conversation_id IS NULL) OR
    (room_id IS NULL AND conversation_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages(room_id, created_at ASC);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS support_conversations_updated_idx ON support_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  target_type varchar(40),
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
