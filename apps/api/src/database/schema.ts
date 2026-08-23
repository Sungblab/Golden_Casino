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

CREATE TABLE IF NOT EXISTS game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type varchar(20) NOT NULL CHECK (game_type IN ('baccarat', 'blackjack')),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(80) NOT NULL,
  min_bet integer NOT NULL CHECK (min_bet > 0),
  max_bet integer NOT NULL CHECK (max_bet >= min_bet),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  choice varchar(30) NOT NULL CHECK (choice IN ('player','banker','tie','player_pair','banker_pair')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payout_minor bigint,
  outcome varchar(20) CHECK (outcome IN ('win','lose','push')),
  status varchar(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','settled','cancelled')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS wagers_round_idx ON wagers(round_id);
CREATE INDEX IF NOT EXISTS wagers_user_idx ON wagers(user_id, placed_at DESC);

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
  bet_minor bigint NOT NULL CHECK (bet_minor > 0),
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'playing' CHECK (status IN ('playing','stand','bust','blackjack','doubled')),
  outcome varchar(20) CHECK (outcome IN ('win','lose','push','blackjack')),
  payout_minor bigint,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS blackjack_hands_round_idx ON blackjack_hands(round_id);
CREATE INDEX IF NOT EXISTS blackjack_hands_user_idx ON blackjack_hands(user_id, placed_at DESC);

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
