import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminCashRequest, AdminOverview, AdminUser, GameRoom } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { decideAdminCashRequest, getAdminCashRequests, getAdminOverview, pauseRoom, resumeRoom, setAdminUserApproval } from "../api";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;

export function AdminPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [cashRequests, setCashRequests] = useState<AdminCashRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [nextOverview, nextRequests] = await Promise.all([getAdminOverview(token), getAdminCashRequests(token)]);
      setOverview(nextOverview);
      setCashRequests(nextRequests);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관리자 정보를 불러오지 못했습니다.");
    }
  }, [token]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const toggleRoom = async (room: GameRoom) => {
    setBusy(`room:${room.id}`);
    try {
      if (room.paused) await resumeRoom(token, room.id);
      else await pauseRoom(token, room.id);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "방 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const toggleUser = async (user: AdminUser) => {
    setBusy(`user:${user.id}`);
    try {
      await setAdminUserApproval(token, user.id, !user.approved);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "사용자 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const decideCash = async (request: AdminCashRequest, decision: "approved" | "rejected") => {
    setBusy(`cash:${request.id}`);
    try {
      await decideAdminCashRequest(token, request.id, decision);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "신청을 처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  if (!overview) return <div className="loading-screen"><p>{error || "관리자 화면을 불러오는 중…"}</p></div>;
  const pendingRequests = cashRequests.filter((request) => request.status === "pending");
  const activeRooms = overview.rooms.filter((room) => room.enabled);
  const onlinePlayers = activeRooms.reduce((sum, room) => sum + room.playerCount, 0);

  return (
    <AppShell balance={overview.walletBalance} onLogout={onLogout}>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>관리 센터</h1>
          <p className="muted">자동 테이블 운영 현황과 정산을 확인합니다.</p>
        </div>
        <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
      </section>

      <section className="admin-kpi-grid" aria-label="운영 요약">
        <AdminKpi label="온라인 플레이어" value={`${onlinePlayers}명`} />
        <AdminKpi label="활성 방" value={`${activeRooms.length}개`} />
        <AdminKpi label="처리 대기 신청" value={`${overview.pendingCashRequests.count}건`} tone={overview.pendingCashRequests.count > 0 ? "warning" : ""} />
        <AdminKpi label="하우스 손익" value={COIN(overview.house.houseProfit)} tone={overview.house.houseProfit >= 0 ? "positive" : "negative"} />
      </section>

      <div className="admin-content-grid">
        <section className="admin-panel admin-room-panel">
          <AdminPanelHeading title="방 관리" note="자동 진행" />
          <div className="admin-room-list">
            {overview.rooms.map((room) => <AdminRoomRow key={room.id} room={room} busy={busy === `room:${room.id}`} onToggle={() => void toggleRoom(room)} />)}
          </div>
        </section>

        <section className="admin-panel admin-house-panel">
          <AdminPanelHeading title="하우스 수익" note="전체 누적" />
          <div className="admin-house-stats">
            <Metric label="하우스 잔액" value={COIN(overview.house.balance)} />
            <Metric label="총 베팅액" value={COIN(overview.house.totalWagered)} />
            <Metric label="정산 베팅" value={`${overview.house.settledWagers.toLocaleString()}회`} />
            <Metric label="참여 사용자" value={`${overview.house.activeBettors.toLocaleString()}명`} />
          </div>
          <div className="admin-result-bar" aria-label="게임 결과 분포">
            <Metric label="플레이어" value={`${overview.house.playerRounds.toLocaleString()}회`} />
            <Metric label="뱅커" value={`${overview.house.bankerRounds.toLocaleString()}회`} />
            <Metric label="타이" value={`${overview.house.tieRounds.toLocaleString()}회`} />
          </div>
          <p className="admin-footnote">누적 라운드 {overview.house.totalRounds.toLocaleString()}회 · 10초마다 갱신</p>
        </section>
      </div>

      <div className="admin-content-grid admin-lower-grid">
        <section className="admin-panel">
          <AdminPanelHeading title="사용자 관리" note={`${overview.users.length}명`} />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>사용자</th><th>상태</th><th>잔액</th><th>베팅</th><th>관리</th></tr></thead>
              <tbody>{overview.users.map((user) => <AdminUserRow key={user.id} user={user} busy={busy === `user:${user.id}`} onToggle={() => void toggleUser(user)} />)}</tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <AdminPanelHeading title="충전·환전 신청" note={`${pendingRequests.length}건 대기`} />
          <div className="admin-table-wrap admin-cash-wrap">
            <table className="admin-table">
              <thead><tr><th>사용자</th><th>구분</th><th>금액</th><th>상태</th><th>처리</th></tr></thead>
              <tbody>{cashRequests.length === 0 ? <tr><td colSpan={5} className="admin-empty">신청 내역이 없습니다.</td></tr> : cashRequests.map((request) => <CashRequestRow key={request.id} request={request} busy={busy === `cash:${request.id}`} onDecide={(decision) => void decideCash(request, decision)} />)}</tbody>
            </table>
          </div>
        </section>
      </div>
      {overview.openSupportConversations > 0 && <p className="admin-notice">답변이 필요한 문의 {overview.openSupportConversations}건이 있습니다. 지원 대화 API에서 확인하세요.</p>}
      {error && <p className="error-message">{error}</p>}
    </AppShell>
  );
}

function AdminKpi({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`admin-kpi ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function AdminPanelHeading({ title, note }: { title: string; note: string }) {
  return <div className="admin-panel-heading"><h2>{title}</h2><span>{note}</span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="admin-metric"><small>{label}</small><strong>{value}</strong></div>;
}

function AdminRoomRow({ room, busy, onToggle }: { room: GameRoom; busy: boolean; onToggle: () => void }) {
  const unavailable = room.gameType === "blackjack" || !room.enabled;
  return <div className={`admin-room-row ${unavailable ? "unavailable" : ""}`}>
    <div className="admin-room-name"><strong>{room.name}</strong><small>{room.minBet}–{room.maxBet} 코인 · {room.playerCount}명</small></div>
    <span className={room.paused || unavailable ? "admin-status muted-status" : "admin-status live-status"}>{unavailable ? "준비 중" : room.paused ? "일시정지" : room.phase}</span>
    <button className="admin-small-button" disabled={busy || unavailable} onClick={onToggle}>{busy ? "처리 중" : room.paused ? "재개" : "일시정지"}</button>
  </div>;
}

function AdminUserRow({ user, busy, onToggle }: { user: AdminUser; busy: boolean; onToggle: () => void }) {
  return <tr>
    <td><strong>{user.username}</strong><small className="admin-subline">{user.role === "admin" ? "관리자" : `${user.wins}승 ${user.losses}패`}</small></td>
    <td><span className={`admin-status ${user.approved ? "live-status" : "muted-status"}`}>{user.approved ? "이용 중" : "승인 대기"}</span></td>
    <td>{COIN(user.balance)}</td>
    <td>{user.totalBets.toLocaleString()}회</td>
    <td>{user.role === "admin" ? <span className="admin-protected">보호됨</span> : <button className="admin-small-button" disabled={busy} onClick={onToggle}>{busy ? "처리 중" : user.approved ? "이용 정지" : "승인"}</button>}</td>
  </tr>;
}

function CashRequestRow({ request, busy, onDecide }: { request: AdminCashRequest; busy: boolean; onDecide: (decision: "approved" | "rejected") => void }) {
  const pending = request.status === "pending";
  return <tr>
    <td><strong>{request.username}</strong><small className="admin-subline">{new Date(request.created_at).toLocaleDateString("ko-KR")}</small></td>
    <td>{request.request_type === "deposit" ? "충전" : "환전"}</td>
    <td>{COIN(request.amount)}</td>
    <td><span className={`admin-status ${pending ? "warning-status" : request.status === "approved" ? "live-status" : "muted-status"}`}>{pending ? "대기" : request.status === "approved" ? "승인" : request.status === "rejected" ? "거절" : "취소"}</span></td>
    <td>{pending ? <div className="admin-cash-actions"><button className="admin-small-button approve" disabled={busy} onClick={() => onDecide("approved")}>승인</button><button className="admin-small-button reject" disabled={busy} onClick={() => onDecide("rejected")}>거절</button></div> : <span className="admin-protected">완료</span>}</td>
  </tr>;
}
