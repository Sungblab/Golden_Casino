import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/** Shared profile dropdown (내 프로필 / 거래 내역 / 로그아웃), used in both the site header and the in-game bar. */
export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        <span>프로필</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <Link to="/profile" onClick={() => setOpen(false)}>내 프로필</Link>
          <Link to="/wallet" onClick={() => setOpen(false)}>거래 내역</Link>
          <button type="button" onClick={onLogout}>로그아웃</button>
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>;
}
