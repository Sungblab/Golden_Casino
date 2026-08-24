import { Link } from "react-router-dom";
import type { AdminCashRequest, GameRoom } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;

export function AdminDashboardPage() {
  const { overview, cashRequests } = useAdminData();
  if (!overview) return null;
  const activeRooms = overview.rooms.filter((room) => room.enabled);
  const pendingCash = cashRequests.filter((request) => request.status === "pending");
  const onlinePlayers = activeRooms.reduce((sum, room) => sum + room.playerCount, 0);

  return (
    <AdminView title="통합 현황" meta="실시간 운영 요약">
      <section className="admin-kpi-grid admin-dashboard-kpis" aria-label="운영 핵심 지표">
        <AdminKpi label="온라인 플레이어" value={`${onlinePlayers}명`} />
        <AdminKpi label="활성 방" value={`${activeRooms.length}개`} />
        <AdminKpi label="충·환전 대기" value={`${pendingCash.length}건`} tone={pendingCash.length ? "warning" : ""} />
        <AdminKpi label="문의 답변 대기" value={`${overview.openSupportConversations}건`} tone={overview.openSupportConversations ? "warning" : ""} />
        <AdminKpi label="누적 손익" value={COIN(overview.house.houseProfit)} tone={overview.house.houseProfit >= 0 ? "positive" : "negative"} />
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <AdminPanelHeading title="지금 처리할 일" note={`${pendingCash.length + overview.openSupportConversations}건`} />
          <div className="admin-action-list">
            {pendingCash.slice(0, 4).map((request) => <CashAction key={request.id} request={request} />)}
            {overview.openSupportConversations > 0 && <Link className="admin-action-row" to="/admin/support"><span className="admin-action-dot inquiry" /><strong>답변 대기 문의</strong><small>{overview.openSupportConversations}건 · 문의·채팅에서 확인</small><b>→</b></Link>}
            {pendingCash.length === 0 && overview.openSupportConversations === 0 && <p className="admin-empty-copy">지금 처리할 대기 항목이 없습니다.</p>}
          </div>
        </section>

        <section className="admin-panel">
          <AdminPanelHeading title="방 현황" action={<Link className="admin-inline-link" to="/admin/games">전체 보기 →</Link>} />
          <div className="admin-live-room-list">{overview.rooms.map((room) => <RoomPreview key={room.id} room={room} />)}</div>
        </section>
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <AdminPanelHeading title="누적 게임 통계" action={<Link className="admin-inline-link" to="/admin/stats">상세 통계 →</Link>} />
          <div className="admin-house-stats">
            <Metric label="총 베팅액" value={COIN(overview.house.totalWagered)} />
            <Metric label="정산 베팅" value={`${overview.house.settledWagers.toLocaleString()}회`} />
            <Metric label="참여 사용자" value={`${overview.house.activeBettors.toLocaleString()}명`} />
            <Metric label="누적 라운드" value={`${overview.house.totalRounds.toLocaleString()}회`} />
          </div>
        </section>
        <section className="admin-panel admin-quick-links">
          <AdminPanelHeading title="빠른 이동" />
          <div><Link to="/admin/cash">충·환전 관리 <span>→</span></Link><Link to="/admin/support">문의·채팅 <span>→</span></Link><Link to="/admin/users">사용자 관리 <span>→</span></Link></div>
        </section>
      </div>
    </AdminView>
  );
}

function CashAction({ request }: { request: AdminCashRequest }) {
  return <Link className="admin-action-row" to="/admin/cash"><span className={`admin-action-dot ${request.request_type}`} /><strong>{request.request_type === "deposit" ? "충전" : "환전"} 신청</strong><small>{request.username} · {COIN(request.amount)}</small><b>→</b></Link>;
}

function RoomPreview({ room }: { room: GameRoom }) {
  return <div className="admin-live-room-row"><span className={`admin-room-led ${room.paused ? "paused" : room.enabled ? "live" : "off"}`} /><div><strong>{room.name}</strong><small>{room.playerCount}명 · {room.phase}</small></div><span className={room.paused ? "admin-status warning-status" : room.enabled ? "admin-status live-status" : "admin-status muted-status"}>{room.paused ? "일시정지" : room.enabled ? "운영 중" : "비활성"}</span></div>;
}
