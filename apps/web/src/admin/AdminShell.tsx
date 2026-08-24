import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@golden/contracts";
import { API_URL } from "../api";
import { AppShell } from "../components/AppShell";
import { AdminDataProvider, useAdminData } from "./AdminData";

type Toast = { id: string; title: string; detail: string; href: string };

export function AdminApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  return <AdminDataProvider token={token}><AdminShell token={token} onLogout={onLogout}><Outlet /></AdminShell></AdminDataProvider>;
}

function AdminShell({ token, onLogout, children }: { token: string; onLogout: () => void; children: ReactNode }) {
  const { overview, cashRequests, error, loading } = useAdminData();
  const [toast, setToast] = useState<Toast | null>(null);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);

  useEffect(() => {
    const onCash = (payload: { id: string; type: "deposit" | "withdraw"; amount: number; username: string }) => {
      setToast({ id: payload.id, title: payload.type === "deposit" ? "새 충전 신청" : "새 환전 신청", detail: `${payload.username} · ${payload.amount.toLocaleString()}코인`, href: "/admin/cash" });
    };
    const onSupport = (message: ChatMessage) => {
      if (message.role !== "user") return;
      setToast({ id: message.id, title: "새 1:1 문의", detail: `${message.username} · ${message.message}`, href: "/admin/support" });
    };
    socket.on("cash.request.created", onCash);
    socket.on("support.message", onSupport);
    socket.connect();
    return () => {
      socket.off("cash.request.created", onCash);
      socket.off("support.message", onSupport);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pendingCash = cashRequests.filter((request) => request.status === "pending").length;
  return (
    <AppShell balance={0} onLogout={onLogout} showAdminLink={false} showBalance={false} headerCenter={<AdminNavigation cashCount={pendingCash} supportCount={overview?.openSupportConversations ?? 0} />}>
      {overview === null ? <div className="loading-screen"><p>{loading ? "관리자 정보를 불러오는 중…" : error || "관리자 정보를 불러오지 못했습니다."}</p></div> : children}
      {toast && <div className="admin-toast" role="status" aria-live="assertive"><div><strong>{toast.title}</strong><span>{toast.detail}</span></div><Link to={toast.href} onClick={() => setToast(null)}>바로 보기</Link><button type="button" aria-label="알림 닫기" onClick={() => setToast(null)}>×</button></div>}
    </AppShell>
  );
}

function AdminNavigation({ cashCount, supportCount }: { cashCount: number; supportCount: number }) {
  const items = [
    { to: "/admin", label: "통합 현황", end: true },
    { to: "/admin/cash", label: "충·환전", badge: cashCount },
    { to: "/admin/support", label: "문의·채팅", badge: supportCount },
    { to: "/admin/users", label: "사용자" },
    { to: "/admin/games", label: "게임 운영" },
    { to: "/admin/stats", label: "통계" },
  ];
  return <nav className="admin-header-nav" aria-label="관리자 메뉴">{items.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}{item.badge ? <span className="admin-nav-badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}</NavLink>)}</nav>;
}
