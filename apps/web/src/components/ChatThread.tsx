import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatMessage } from "@golden/contracts";
import { MAX_CHAT_LENGTH_HINT } from "../lib/chat";

export function ChatThread({ messages, currentUserId, emptyText }: { messages: ChatMessage[]; currentUserId?: string | null; emptyText: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages]);

  return (
    <div className="chat-thread" ref={ref} aria-live="polite">
      {messages.length === 0 && <p className="chat-thread-empty">{emptyText}</p>}
      {messages.map((message) => (
        <article key={message.id} className={`chat-bubble ${message.userId === currentUserId ? "is-mine" : ""} ${message.role === "admin" ? "is-admin" : ""}`}>
          <div className="chat-bubble-meta">
            <strong>{message.role === "admin" ? "관리자" : message.username}</strong>
            <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
          <p>{message.message}</p>
        </article>
      ))}
    </div>
  );
}

export function ChatComposer({ onSend, disabled = false, placeholder = "메시지를 입력하세요" }: { onSend: (message: string) => Promise<boolean>; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending || disabled) return;
    setSending(true);
    try {
      if (await onSend(message)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-composer">
      <input
        value={draft}
        maxLength={MAX_CHAT_LENGTH_HINT}
        placeholder={placeholder}
        disabled={disabled || sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
        }}
      />
      <button type="button" onClick={() => void submit()} disabled={disabled || sending || !draft.trim()} aria-label="메시지 전송">
        <Send size={17} />
      </button>
    </div>
  );
}
