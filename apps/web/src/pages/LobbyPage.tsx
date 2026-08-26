import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GameRoom, PublicAuthUser } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { BigRoad } from "../components/BigRoad";
import { Dropdown } from "../components/Dropdown";
import { getLobby, pauseRoom, resumeRoom } from "../api";

const POLL_INTERVAL_MS = 5_000;

export function LobbyPage({ token, user, onLogout }: { token: string; user: PublicAuthUser | null; onLogout: () => void }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [balance, setBalance] = useState(0);
  const [selectedGame, setSelectedGame] = useState<"all" | "baccarat" | "blackjack" | "dragon_tiger" | "holdem" | "sutda">("all");
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
  const sutdaRooms = rooms.filter((room) => room.gameType === "sutda");

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
            : room.gameType === "holdem" ? `/rooms/holdem/${room.id}`
              : room.gameType === "sutda" ? `/rooms/sutda/${room.id}` : `/rooms/${room.id}`
      )}>
        입장
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
          <button className={selectedGame === "dragon_tiger" ? "active" : ""} onClick={() => setSelectedGame("dragon_tiger")} role="tab" aria-selected={selectedGame === "dragon_tiger"}>드래곤 타이거 <span>{dragonTigerRooms.length}</span></button>
          <button className={selectedGame === "blackjack" ? "active" : ""} onClick={() => setSelectedGame("blackjack")} role="tab" aria-selected={selectedGame === "blackjack"}>
            블랙잭 <span>{blackjackRooms.length}</span>
          </button>
          <button className={selectedGame === "holdem" ? "active" : ""} onClick={() => setSelectedGame("holdem")} role="tab" aria-selected={selectedGame === "holdem"}>홀덤 <span>{holdemRooms.length}</span></button>
          <button className={selectedGame === "sutda" ? "active" : ""} onClick={() => setSelectedGame("sutda")} role="tab" aria-selected={selectedGame === "sutda"}>섯다 <span>{sutdaRooms.length}</span></button>
        </div>
        {/* Five tabs don't fit a phone width without wrapping or truncating — a dropdown reads
            better than a cramped/scrolling tab row. Swapped for the tablist below 620px. */}
        <Dropdown
          className="game-switcher-mobile"
          ariaLabel="게임 선택"
          value={selectedGame}
          onChange={(next) => setSelectedGame(next as typeof selectedGame)}
          options={[
            { value: "all", label: `전체 (${rooms.length})` },
            { value: "baccarat", label: `바카라 (${baccaratRooms.length})` },
            { value: "dragon_tiger", label: `드래곤 타이거 (${dragonTigerRooms.length})` },
            { value: "blackjack", label: `블랙잭 (${blackjackRooms.length})` },
            { value: "holdem", label: `홀덤 (${holdemRooms.length})` },
            { value: "sutda", label: `섯다 (${sutdaRooms.length})` },
          ]}
        />
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
          <section className="room-section">
            <h2 className="room-section-title">
              블랙잭 <span>{blackjackRooms.length}</span>
            </h2>
            <div className="room-grid">{blackjackRooms.map(renderCard)}</div>
          </section>
          {holdemRooms.length > 0 && <section className="room-section"><h2 className="room-section-title">홀덤 PvP <span>{holdemRooms.length}</span></h2><div className="room-grid">{holdemRooms.map(renderCard)}</div></section>}
          {sutdaRooms.length > 0 && <section className="room-section"><h2 className="room-section-title">섯다 PvP <span>{sutdaRooms.length}</span></h2><div className="room-grid">{sutdaRooms.map(renderCard)}</div></section>}
        </>
      ) : (
        <div className="room-grid">{(selectedGame === "baccarat" ? baccaratRooms : selectedGame === "blackjack" ? blackjackRooms : selectedGame === "dragon_tiger" ? dragonTigerRooms : selectedGame === "holdem" ? holdemRooms : sutdaRooms).map(renderCard)}</div>
      )}
      {error && <p className="error-message">{error}</p>}

      <footer className="lobby-footer">
        <strong className="lobby-footer-brand">GOLDEN CASINO</strong>
        <nav className="lobby-footer-links" aria-label="바로가기">
          <Link to="/wallet">지갑</Link>
          <Link to="/profile">프로필</Link>
          <Link to="/game-history">게임 기록</Link>
          <Link to="/support">고객센터</Link>
        </nav>
        <p className="lobby-footer-copy">© {new Date().getFullYear()} Golden Casino. All rights reserved.</p>
      </footer>
    </AppShell>
  );
}
