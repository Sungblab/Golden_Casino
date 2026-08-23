import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { MessageCircle, Send, X } from "lucide-react";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@golden/contracts";
import { MAX_CHAT_LENGTH_HINT } from "../lib/chat";
import { getRoomChatMessages } from "../api";

function currentUserId(): string | null {
  try {
    return JSON.parse(sessionStorage.getItem("golden.user") ?? "null")?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Floating chat button + overlay panel for a game room. Reuses the room page's existing
 * socket connection (no second connection) and loads history over REST on open/mount.
 */
export function RoomChat({
  socket,
  roomId,
  token,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const myUserId = useRef(currentUserId());

  useEffect(() => {
    let cancelled = false;
    getRoomChatMessages(token, roomId)
      .then((history) => {
        if (!cancelled) setMessages(history.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, roomId]);

  useEffect(() => {
    const handle = (message: ChatMessage) => {
      if (message.roomId !== roomId) return;
      setMessages((current) => [...current, message]);
      setUnread((current) => (open ? current : current + 1));
    };
    socket.on("room.chat.message", handle);
    return () => {
      socket.off("room.chat.message", handle);
    };
  }, [socket, roomId, open]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    socket.emit("room.chat.send", { roomId, message: value }, (ack) => {
      if (ack.ok) {
        setDraft("");
        setError("");
      } else {
        setError(ack.error);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className="room-chat-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "채팅 닫기" : "채팅 열기"}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
        {!open && unread > 0 && <span className="room-chat-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="room-chat-panel" role="dialog" aria-label="룸 채팅">
          <div className="room-chat-head">
            <span>테이블 채팅</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="채팅 닫기">
              <X size={16} />
            </button>
          </div>
          <div className="room-chat-list" ref={listRef}>
            {messages.length === 0 && <p className="room-chat-empty">아직 대화가 없습니다. 첫 메시지를 남겨보세요!</p>}
            {messages.map((message) => (
              <div key={message.id} className={`room-chat-message ${message.userId === myUserId.current ? "is-mine" : ""}`}>
                <span className="room-chat-author">{message.username}</span>
                <span className="room-chat-text">{message.message}</span>
              </div>
            ))}
          </div>
          <div className="room-chat-composer">
            <input
              type="text"
              value={draft}
              maxLength={MAX_CHAT_LENGTH_HINT}
              placeholder="메시지 입력…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") send();
              }}
            />
            <button type="button" onClick={send} aria-label="전송">
              <Send size={16} />
            </button>
          </div>
          {error && <p className="room-chat-error">{error}</p>}
        </div>
      )}
    </>
  );
}
