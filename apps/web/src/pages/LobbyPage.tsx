import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameRoom, PublicAuthUser } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { BigRoad } from "../components/BigRoad";
import { getLobby, pauseRoom, resumeRoom } from "../api";

const POLL_INTERVAL_MS = 5_000;

export function LobbyPage({ token, user, onLogout }: { token: string; user: PublicAuthUser | null; onLogout: () => void }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [balance, setBalance] = useState(0);
  const [selectedGame, setSelectedGame] = useState<"all" | "baccarat" | "blackjack" | "dragon_tiger" | "holdem">("all");
  const [error, setError] = useState("");
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  const reload = useCallback(() => {
    getLobby(token)
      .then((data) => {
        setRooms(data.rooms);
        setBalance(data.walletBalance);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "로비 정보를 불러오지 못했습니다."));
  }, [token]);

  useEffect(() => reload(), [reload]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      reload();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [reload]);

  const togglePause = async (room: GameRoom) => {
    setBusyRoomId(room.id);
    try {
      if (room.paused) await resumeRoom(token, room.id);
      else await pauseRoom(token, room.id);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청에 실패했습니다.");
    } finally {
      setBusyRoomId(null);
    }
  };

  const baccaratRooms = rooms.filter((room) => room.gameType === "baccarat" || room.gameType === "lightning_baccarat");
  const blackjackRooms = rooms.filter((room) => room.gameType === "blackjack" || room.gameType === "lightning_blackjack");
  const dragonTigerRooms = rooms.filter((room) => room.gameType === "dragon_tiger");
  const holdemRooms = rooms.filter((room) => room.gameType === "holdem");

  const renderCard = (room: GameRoom) => (
    <article className="room-card" key={room.id}>
      <div className="room-top">
        <span className={room.paused ? "waiting" : room.phase === "WAITING" ? "waiting" : "live-pill"}>
          {room.paused ? "일시정지" : room.phase === "WAITING" ? "대기 중" : room.phase}
        </span>
        <span>{room.playerCount}명</span>
      </div>
      <h3>{room.name}</h3>
      <p>
        {room.minBet}–{room.maxBet} 코인
      </p>
      {(room.gameType === "baccarat" || room.gameType === "lightning_baccarat") && <BigRoad history={room.recentResults ?? []} compact />}
      {room.gameType === "dragon_tiger" && <BigRoad history={room.recentResults ?? []} compact labels={{ player: "D", banker: "T" }} />}
      <button className="outline-button" onClick={() => navigate(
        room.gameType === "blackjack" || room.gameType === "lightning_blackjack" ? `/rooms/blackjack/${room.id}`
          : room.gameType === "dragon_tiger" ? `/rooms/dragon-tiger/${room.id}`
            : room.gameType === "holdem" ? `/rooms/holdem/${room.id}` : `/rooms/${room.id}`
      )}>
        테이블 입장
      </button>
      {user?.role === "admin" && (
        <button className="admin-toggle-button" disabled={busyRoomId === room.id} onClick={() => togglePause(room)}>
          {room.paused ? "방 재개" : "방 일시정지"}
        </button>
      )}
    </article>
  );

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="lobby-toolbar">
        <div className="game-switcher" role="tablist" aria-label="게임 선택">
          <button className={selectedGame === "all" ? "active" : ""} onClick={() => setSelectedGame("all")} role="tab" aria-selected={selectedGame === "all"}>
            전체 <span>{rooms.length}</span>
          </button>
          <button className={selectedGame === "baccarat" ? "active" : ""} onClick={() => setSelectedGame("baccarat")} role="tab" aria-selected={selectedGame === "baccarat"}>
            바카라 <span>{baccaratRooms.length}</span>
          </button>
          <button className={selectedGame === "blackjack" ? "active" : ""} onClick={() => setSelectedGame("blackjack")} role="tab" aria-selected={selectedGame === "blackjack"}>
            블랙잭 <span>{blackjackRooms.length}</span>
          </button>
          <button className={selectedGame === "dragon_tiger" ? "active" : ""} onClick={() => setSelectedGame("dragon_tiger")} role="tab" aria-selected={selectedGame === "dragon_tiger"}>드래곤 타이거 <span>{dragonTigerRooms.length}</span></button>
          <button className={selectedGame === "holdem" ? "active" : ""} onClick={() => setSelectedGame("holdem")} role="tab" aria-selected={selectedGame === "holdem"}>홀덤 <span>{holdemRooms.length}</span></button>
        </div>
        {/* Five tabs don't fit a phone width without wrapping or truncating — a dropdown reads
            better than a cramped/scrolling tab row. Swapped for the tablist below 620px. */}
        <select
          className="game-switcher-mobile"
          aria-label="게임 선택"
          value={selectedGame}
          onChange={(event) => setSelectedGame(event.target.value as typeof selectedGame)}
        >
          <option value="all">전체 ({rooms.length})</option>
          <option value="baccarat">바카라 ({baccaratRooms.length})</option>
          <option value="blackjack">블랙잭 ({blackjackRooms.length})</option>
          <option value="dragon_tiger">드래곤 타이거 ({dragonTigerRooms.length})</option>
          <option value="holdem">홀덤 ({holdemRooms.length})</option>
        </select>
      </div>

      {selectedGame === "all" ? (
        <>
          <section className="room-section">
            <h2 className="room-section-title">
              바카라 <span>{baccaratRooms.length}</span>
            </h2>
            <div className="room-grid">{baccaratRooms.map(renderCard)}</div>
          </section>
          <section className="room-section"><h2 className="room-section-title">드래곤 타이거 <span>{dragonTigerRooms.length}</span></h2><div className="room-grid">{dragonTigerRooms.map(renderCard)}</div></section>
          {holdemRooms.length > 0 && <section className="room-section"><h2 className="room-section-title">홀덤 PvP <span>{holdemRooms.length}</span></h2><div className="room-grid">{holdemRooms.map(renderCard)}</div></section>}
          <section className="room-section">
            <h2 className="room-section-title">
              블랙잭 <span>{blackjackRooms.length}</span>
            </h2>
            <div className="room-grid">{blackjackRooms.map(renderCard)}</div>
          </section>
        </>
      ) : (
        <div className="room-grid">{(selectedGame === "baccarat" ? baccaratRooms : selectedGame === "blackjack" ? blackjackRooms : selectedGame === "dragon_tiger" ? dragonTigerRooms : holdemRooms).map(renderCard)}</div>
      )}
      {error && <p className="error-message">{error}</p>}
    </AppShell>
  );
}
