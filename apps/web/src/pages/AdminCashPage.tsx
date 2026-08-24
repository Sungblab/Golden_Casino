import { useState } from "react";
import type { AdminCashRequest } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { decideAdminCashRequest } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";

const COIN = (value: number) => `${value.toLocaleString()}코인`;

export function AdminCashPage() {
  const { token, cashRequests, refresh } = useAdminData();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = cashRequests.filter((request) => request.status === "pending");
  const items = filter === "pending" ? pending : cashRequests;
  const decide = async (request: AdminCashRequest, decision: "approved" | "rejected") => {
    setBusy(request.id);
    setError("");
    try { await decideAdminCashRequest(token, request.id, decision); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "신청을 처리하지 못했습니다."); }
    finally { setBusy(null); }
  };

  return <AdminView title="충·환전" meta={`${pending.length}건 처리 대기`}>
    <section className="admin-panel admin-full-panel">
      <AdminPanelHeading title="신청 내역" action={<div className="admin-filter-tabs"><button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>대기 {pending.length}</button><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 {cashRequests.length}</button></div>} />
      <div className="admin-table-wrap"><table className="admin-table admin-cash-table"><thead><tr><th>사용자</th><th>구분</th><th>금액</th><th>남은 롤링</th><th>신청 시각</th><th>상태</th><th>처리</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={7} className="admin-empty">처리할 신청이 없습니다.</td></tr> : items.map((request) => <CashRow key={request.id} request={request} busy={busy === request.id} onDecide={(decision) => void decide(request, decision)} />)}</tbody></table></div>
      {error && <p className="error-message">{error}</p>}
    </section>
  </AdminView>;
}

function CashRow({ request, busy, onDecide }: { request: AdminCashRequest; busy: boolean; onDecide: (decision: "approved" | "rejected") => void }) {
  const pending = request.status === "pending";
  const rollingLocked = request.request_type === "withdraw" && request.wageringRemaining > 0;
  return <tr><td><strong>{request.username}</strong></td><td><span className={`admin-cash-type ${request.request_type}`}>{request.request_type === "deposit" ? "충전" : "환전"}</span></td><td>{COIN(request.amount)}</td><td><span className={request.wageringRemaining > 0 ? "admin-rolling-left" : "admin-rolling-done"}>{request.wageringRemaining > 0 ? COIN(request.wageringRemaining) : "완료"}</span></td><td>{new Date(request.created_at).toLocaleString("ko-KR")}</td><td><span className={`admin-status ${pending ? "warning-status" : request.status === "approved" ? "live-status" : "muted-status"}`}>{pending ? "대기" : request.status === "approved" ? "승인" : request.status === "rejected" ? "거절" : "취소"}</span></td><td>{pending ? <div className="admin-cash-actions"><button className="admin-small-button approve" title={rollingLocked ? "롤링 완료 후 승인할 수 있습니다." : undefined} disabled={busy || rollingLocked} onClick={() => onDecide("approved")}>승인</button><button className="admin-small-button reject" disabled={busy} onClick={() => onDecide("rejected")}>거절</button></div> : "—"}</td></tr>;
}
