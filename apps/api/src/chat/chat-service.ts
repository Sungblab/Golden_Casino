import { pool } from "../database/pool.js";
import type { ChatMessage, SupportConversation } from "@golden/contracts";

export const MAX_CHAT_LENGTH = 500;

interface MessageRow {
  id: string;
  room_id: string | null;
  conversation_id: string | null;
  user_id: string;
  username: string;
  role: "user" | "admin";
  message: string;
  highlighted: boolean;
  created_at: string | Date;
}

function normalizedMessage(message: string): string {
  const value = message.trim();
  if (!value) throw new Error("CHAT_EMPTY");
  if (value.length > MAX_CHAT_LENGTH) throw new Error("CHAT_TOO_LONG");
  return value;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    message: row.message,
    highlighted: row.highlighted,
    createdAt: toIso(row.created_at),
  };
}

// ChatMessage.username is the display value shown in chat bubbles, so it's
// sourced from the account's nickname rather than its login username.
const messageSelect = `
  SELECT cm.id,cm.room_id,cm.conversation_id,cm.user_id,u.nickname AS username,u.role,
         cm.message,cm.highlighted,cm.created_at
  FROM chat_messages cm
  JOIN users u ON u.id=cm.user_id
`;

export async function listRoomMessages(roomId: string, limit = 100): Promise<ChatMessage[]> {
  const result = await pool.query<MessageRow>(`${messageSelect} WHERE cm.room_id=$1 ORDER BY cm.created_at DESC LIMIT $2`, [roomId, limit]);
  return result.rows.reverse().map(mapMessage);
}

export async function createRoomMessage(userId: string, roomId: string, message: string): Promise<ChatMessage> {
  const value = normalizedMessage(message);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (room_id,user_id,message)
     SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM game_rooms WHERE id=$1 AND enabled=true)
     RETURNING id`,
    [roomId, userId, value],
  );
  if (result.rowCount === 0) throw new Error("ROOM_NOT_FOUND");
  return getMessage(result.rows[0]!.id);
}

async function getMessage(id: string): Promise<ChatMessage> {
  const result = await pool.query<MessageRow>(`${messageSelect} WHERE cm.id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw new Error("CHAT_NOT_FOUND");
  return mapMessage(row);
}

async function getOrCreateConversation(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO support_conversations (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
     RETURNING id`,
    [userId],
  );
  return result.rows[0]!.id;
}

export async function listSupportMessages(userId: string, limit = 200): Promise<ChatMessage[]> {
  const result = await pool.query<{ id: string }>("SELECT id FROM support_conversations WHERE user_id=$1", [userId]);
  if (!result.rows[0]) return [];
  return listConversationMessages(result.rows[0].id, limit);
}

export async function createSupportMessage(userId: string, message: string): Promise<ChatMessage> {
  const value = normalizedMessage(message);
  const conversationId = await getOrCreateConversation(userId);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (conversation_id,user_id,message) VALUES ($1,$2,$3) RETURNING id`,
    [conversationId, userId, value],
  );
  await pool.query("UPDATE support_conversations SET status='open',updated_at=now() WHERE id=$1", [conversationId]);
  return getMessage(result.rows[0]!.id);
}

export async function listConversationMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const result = await pool.query<MessageRow>(`${messageSelect} WHERE cm.conversation_id=$1 ORDER BY cm.created_at DESC LIMIT $2`, [conversationId, limit]);
  return result.rows.reverse().map(mapMessage);
}

export async function listAdminSupportConversations(limit = 100): Promise<SupportConversation[]> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    username: string;
    status: "open" | "closed";
    updated_at: string | Date;
    last_message_id: string | null;
  }>(
    `SELECT sc.id,sc.user_id,u.username,sc.status,sc.updated_at,lm.id AS last_message_id
     FROM support_conversations sc
     JOIN users u ON u.id=sc.user_id
     LEFT JOIN LATERAL (
       SELECT id FROM chat_messages WHERE conversation_id=sc.id ORDER BY created_at DESC LIMIT 1
     ) lm ON true
     ORDER BY sc.updated_at DESC LIMIT $1`,
    [limit],
  );
  const items = await Promise.all(result.rows.map(async (row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    status: row.status,
    lastMessage: row.last_message_id ? await getMessage(row.last_message_id) : null,
    updatedAt: toIso(row.updated_at),
  })));
  return items;
}

export async function createAdminSupportMessage(adminId: string, conversationId: string, message: string): Promise<{ message: ChatMessage; recipientUserId: string }> {
  const value = normalizedMessage(message);
  const conversation = await pool.query<{ user_id: string }>("SELECT user_id FROM support_conversations WHERE id=$1", [conversationId]);
  const recipientUserId = conversation.rows[0]?.user_id;
  if (!recipientUserId) throw new Error("CONVERSATION_NOT_FOUND");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (conversation_id,user_id,message,highlighted) VALUES ($1,$2,$3,true) RETURNING id`,
    [conversationId, adminId, value],
  );
  // `open` means the user is waiting for an administrator response. A reply
  // resolves the queue item; the next user message re-opens it automatically.
  await pool.query("UPDATE support_conversations SET status='closed',updated_at=now() WHERE id=$1", [conversationId]);
  return { message: await getMessage(result.rows[0]!.id), recipientUserId };
}
