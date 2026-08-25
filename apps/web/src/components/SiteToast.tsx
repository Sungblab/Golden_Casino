import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SiteAnnouncement } from "@golden/contracts";
import { API_URL } from "../api";

/**
 * Global admin-broadcast toast. Mounted once at the App root (independent of whatever page/room
 * socket is otherwise active) so an announcement reaches a user regardless of which page they're
 * on. Every authenticated socket — this one included — auto-joins `support:user:<id>` on connect
 * (see main.ts), which is how the server delivers room-scoped broadcasts to just that room's
 * current occupants; site-wide ones are a plain io.emit and reach this socket too.
 */
export function SiteToast({ token }: { token: string }) {
  const [announcement, setAnnouncement] = useState<SiteAnnouncement | null>(null);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

  useEffect(() => {
    const handle = (payload: SiteAnnouncement) => setAnnouncement(payload);
    socket.on("site.announcement", handle);
    socket.connect();
    return () => {
      socket.off("site.announcement", handle);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  if (!announcement) return null;

  return (
    <div className="site-toast" role="status" aria-live="assertive">
      <span className="site-toast-badge">공지</span>
      <span className="site-toast-text">{announcement.message}</span>
      <button type="button" aria-label="알림 닫기" onClick={() => setAnnouncement(null)}>
        ×
      </button>
    </div>
  );
}
