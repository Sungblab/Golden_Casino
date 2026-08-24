import { useAdminData } from "../admin/AdminData";
import { AdminKpi, AdminPanelHeading, AdminView, Metric } from "./AdminView";

const COIN = (value: number) => `${value >= 0 ? "" : "-"}${Math.abs(value).toLocaleString()}코인`;

export function AdminStatsPage() {
  const { overview } = useAdminData();
  if (!overview) return null;
  const { house } = overview;
  return <AdminView title="통계" meta="누적 운영 데이터"><section className="admin-kpi-grid admin-stats-kpis"><AdminKpi label="총 베팅액" value={COIN(house.totalWagered)} /><AdminKpi label="누적 손익" value={COIN(house.houseProfit)} tone={house.houseProfit >= 0 ? "positive" : "negative"} /><AdminKpi label="정산 베팅" value={`${house.settledWagers.toLocaleString()}회`} /><AdminKpi label="참여 사용자" value={`${house.activeBettors.toLocaleString()}명`} /></section><section className="admin-panel admin-full-panel"><AdminPanelHeading title="게임 결과 분포" note={`누적 라운드 ${house.totalRounds.toLocaleString()}회`} /><div className="admin-house-stats admin-result-stats"><Metric label="플레이어" value={`${house.playerRounds.toLocaleString()}회`} /><Metric label="뱅커" value={`${house.bankerRounds.toLocaleString()}회`} /><Metric label="타이" value={`${house.tieRounds.toLocaleString()}회`} /></div></section></AdminView>;
}
