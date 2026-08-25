import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ClientToServerEvents, ProfileResponse, ServerToClientEvents } from "@golden/contracts";
import { API_URL, getProfile, getSupportMessages } from "../api";
import { AppShell } from "../components/AppShell";
import { ChatComposer, ChatThread } from "../components/ChatThread";

function appendMessage(current: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return current.some((item) => item.id === message.id) ? current : [...current, message];
}

export function SupportPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(token), getSupportMessages(token)])
      .then(([nextProfile, history]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setMessages(history.items);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "문의 내역을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleMessage = (message: ChatMessage) => {
      if (message.conversationId) setMessages((current) => appendMessage(current, message));
    };
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("support.message", handleMessage);
    socket.connect();
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("support.message", handleMessage);
      socket.disconnect();
    };
  }, [socket]);

  const send = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!socket.connected) {
      setError("실시간 상담 서버에 연결 중입니다. 잠시 후 다시 시도해주세요.");
      resolve(false);
      return;
    }
    socket.emit("support.send", { message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setMessages((current) => appendMessage(current, ack.data));
      setError("");
      resolve(true);
    });
  });

  return (
    <AppShell balance={profile?.walletBalance ?? 0} onLogout={onLogout}>
      <section className="support-heading">
        <div>
          <h1>1:1 문의</h1>
        </div>
        <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
      </section>

      <section className="support-card" aria-label="관리자 1대1 문의">
        <header className="support-card-head">
          <div><strong>Golden Casino 고객센터</strong><small><i className={connected ? "is-online" : ""} />{connected ? "실시간 연결됨" : "연결 중"}</small></div>
        </header>
        <ChatThread messages={messages} currentUserId={profile?.user.id} emptyText="궁금한 점이나 도움이 필요한 내용을 남겨주세요. 관리자가 확인 후 답변해드립니다." />
        <ChatComposer onSend={send} disabled={!connected} placeholder="문의 내용을 입력하세요" />
        {error && <p className="chat-error">{error}</p>}
      </section>
    </AppShell>
  );
}
