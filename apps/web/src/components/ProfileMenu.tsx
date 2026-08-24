import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";

/** Shared profile dropdown (내 프로필 / 게임 기록 / 로그아웃), used in both the site header and the in-game bar. */
export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("golden.user") ?? "null")?.role === "admin";
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="profile-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="menu">
        <UserRound className="profile-user-icon" size={16} />
        <span>프로필</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <Link to="/profile" onClick={() => setOpen(false)}>내 프로필</Link>
          <Link to="/wallet" onClick={() => setOpen(false)}>게임 기록</Link>
          <Link to={isAdmin ? "/admin/support" : "/support"} onClick={() => setOpen(false)}>{isAdmin ? "문의 관리" : "1:1 문의"}</Link>
          <button type="button" onClick={onLogout}>로그아웃</button>
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>;
}
