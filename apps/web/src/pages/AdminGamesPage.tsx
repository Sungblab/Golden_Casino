import { useState } from "react";
import type { GameRoom } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { pauseRoom, resumeRoom } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";

export function AdminGamesPage() {
  const { token, overview, refresh } = useAdminData();
  const [busy, setBusy] = useState<string | null>(null);
  if (!overview) return null;
  const toggle = async (room: GameRoom) => { setBusy(room.id); try { if (room.paused) await resumeRoom(token, room.id); else await pauseRoom(token, room.id); await refresh(); } finally { setBusy(null); } };
  return <AdminView title="게임 운영" meta={`${overview.rooms.length}개 방`}><section className="admin-panel admin-full-panel"><AdminPanelHeading title="방 상태" note="자동 진행 테이블" /><div className="admin-game-list">{overview.rooms.map((room) => <GameRow key={room.id} room={room} busy={busy === room.id} onToggle={() => void toggle(room)} />)}</div></section></AdminView>;
}

function GameRow({ room, busy, onToggle }: { room: GameRoom; busy: boolean; onToggle: () => void }) {
  return <div className="admin-game-row"><div><strong>{room.name}</strong><small>{room.gameType === "baccarat" ? "바카라" : "블랙잭"} · {room.minBet}–{room.maxBet}코인 · {room.playerCount}명 접속</small></div><span className={`admin-status ${room.paused ? "warning-status" : room.enabled ? "live-status" : "muted-status"}`}>{room.paused ? "일시정지" : room.enabled ? room.phase : "비활성"}</span><button className="admin-small-button" disabled={busy || !room.enabled} onClick={onToggle}>{busy ? "처리 중" : room.paused ? "재개" : "일시정지"}</button></div>;
}
