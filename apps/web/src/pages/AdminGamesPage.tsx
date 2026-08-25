import { useState } from "react";
import type { GameRoom } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { pauseRoom, resetRoomRoad, resumeRoom, sendAdminBroadcast } from "../api";
import { Dropdown } from "../components/Dropdown";
import { AdminPanelHeading, AdminView } from "./AdminView";

const GAME_TYPE_LABEL: Record<GameRoom["gameType"], string> = {
  baccarat: "바카라",
  lightning_baccarat: "라이트닝 바카라",
  blackjack: "블랙잭",
  lightning_blackjack: "라이트닝 블랙잭",
  dragon_tiger: "드래곤타이거",
  holdem: "홀덤",
  sutda: "섯다",
};

/** Only these game types track a road/scoreboard, so only they get a "통계 초기화" button. */
const HAS_ROAD: ReadonlySet<GameRoom["gameType"]> = new Set(["baccarat", "lightning_baccarat", "dragon_tiger"]);

export function AdminGamesPage() {
  const { token, overview, refresh } = useAdminData();
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  if (!overview) return null;
  const toggle = async (room: GameRoom) => { setBusy(room.id); try { if (room.paused) await resumeRoom(token, room.id); else await pauseRoom(token, room.id); await refresh(); } finally { setBusy(null); } };
  const resetRoad = async (room: GameRoom) => {
    if (!window.confirm(`${room.name}의 로드맵/통계를 초기화할까요? 지금까지의 판 기록 자체는 그대로 남고, 화면에 보이는 로드맵만 빈 상태로 새로 시작합니다.`)) return;
    setResetting(room.id);
    try {
      await resetRoomRoad(token, room.id);
      await refresh();
    } finally {
      setResetting(null);
    }
  };
  return (
    <AdminView title="게임 운영" meta={`${overview.rooms.length}개 방`}>
      <BroadcastPanel token={token} rooms={overview.rooms} />
      <section className="admin-panel admin-full-panel">
        <AdminPanelHeading title="방 상태" note="자동 진행 테이블" />
        <div className="admin-game-list">
          {overview.rooms.map((room) => (
            <GameRow
              key={room.id}
              room={room}
              busy={busy === room.id}
              onToggle={() => void toggle(room)}
              resetting={resetting === room.id}
              onResetRoad={HAS_ROAD.has(room.gameType) ? () => void resetRoad(room) : undefined}
            />
          ))}
        </div>
      </section>
    </AdminView>
  );
}

/** Sends a toast (site.announcement) either to every connected user or to just one live room's current occupants. */
function BroadcastPanel({ token, rooms }: { token: string; rooms: GameRoom[] }) {
  const [scope, setScope] = useState<"all" | "room">("all");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");

  const send = async () => {
    const value = message.trim();
    if (!value) return;
    if (scope === "room" && !roomId) {
      setStatus("방을 선택해주세요.");
      return;
    }
    setSending(true);
    setStatus("");
    try {
      await sendAdminBroadcast(token, scope === "all" ? { scope, message: value } : { scope, roomId, message: value });
      setMessage("");
      setStatus("전송했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="admin-panel admin-full-panel admin-broadcast-panel">
      <AdminPanelHeading title="공지 보내기" note="접속 중인 유저에게 토스트로 즉시 노출" />
      <div className="admin-broadcast-form">
        <div className="admin-broadcast-scope">
          <label><input type="radio" name="broadcast-scope" checked={scope === "all"} onChange={() => setScope("all")} /> 전체 유저</label>
          <label><input type="radio" name="broadcast-scope" checked={scope === "room"} onChange={() => setScope("room")} /> 특정 방</label>
        </div>
        {scope === "room" && (
          <Dropdown
            ariaLabel="공지 대상 방"
            value={roomId}
            onChange={setRoomId}
            options={rooms.map((room) => ({ value: room.id, label: `${room.name} (${GAME_TYPE_LABEL[room.gameType]})` }))}
          />
        )}
        <textarea
          value={message}
          maxLength={200}
          placeholder="유저에게 보낼 메시지를 입력하세요"
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="admin-broadcast-actions">
          <button type="button" className="admin-small-button" disabled={sending || !message.trim()} onClick={() => void send()}>
            {sending ? "전송 중" : "보내기"}
          </button>
          {status && <span className="admin-broadcast-status">{status}</span>}
        </div>
      </div>
    </section>
  );
}

function GameRow({ room, busy, onToggle, resetting, onResetRoad }: { room: GameRoom; busy: boolean; onToggle: () => void; resetting: boolean; onResetRoad?: () => void }) {
  return <div className="admin-game-row"><div><strong>{room.name}</strong><small>{GAME_TYPE_LABEL[room.gameType]} · {room.minBet}–{room.maxBet}코인 · {room.playerCount}명 접속</small></div><span className={`admin-status ${room.paused ? "warning-status" : room.enabled ? "live-status" : "muted-status"}`}>{room.paused ? "일시정지" : room.enabled ? room.phase : "비활성"}</span><div className="admin-game-row-actions">{onResetRoad && <button className="admin-small-button" disabled={resetting} onClick={onResetRoad} title="이 방의 로드맵/통계를 빈 상태로 초기화">{resetting ? "초기화 중" : "통계 초기화"}</button>}<button className="admin-small-button" disabled={busy || !room.enabled} onClick={onToggle}>{busy ? "처리 중" : room.paused ? "재개" : "일시정지"}</button></div></div>;
}
