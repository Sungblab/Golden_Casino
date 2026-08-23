import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Brand } from "./Brand";
import { ProfileMenu } from "./ProfileMenu";
import { SoundToggle } from "./SoundToggle";
import { useCountUp } from "../lib/useCountUp";

export function AppShell({ balance, onLogout, children }: { balance: number; onLogout: () => void; children: ReactNode }) {
  const displayBalance = useCountUp(balance);
  const isAdmin = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("golden.user") ?? "null")?.role === "admin";
    } catch {
      return false;
    }
  })();
  return (
    <>
      <header className="topbar">
        <Link className="brand-home" to="/lobby" aria-label="Golden Casino 로비">
          <Brand />
        </Link>
        <div className="account">
          {isAdmin && <Link className="admin-nav-link" to="/admin">관리</Link>}
          <SoundToggle />
          <div className="balance-display" aria-label="현재 잔액">
            <strong>{displayBalance.toLocaleString()}코인</strong>
          </div>
          <ProfileMenu onLogout={onLogout} />
        </div>
      </header>
      <main className="app-shell">{children}</main>
    </>
  );
}
