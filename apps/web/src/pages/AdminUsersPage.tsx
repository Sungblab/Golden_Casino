import { useMemo, useState } from "react";
import type { AdminUser } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { setAdminUserApproval } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";

const COIN = (value: number) => `${value.toLocaleString()}코인`;

export function AdminUsersPage() {
  const { token, overview, refresh } = useAdminData();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!overview) return null;
  const users = useMemo(() => overview.users.filter((user) => user.username.toLowerCase().includes(query.trim().toLowerCase())), [overview.users, query]);
  const toggle = async (user: AdminUser) => { setBusy(user.id); try { await setAdminUserApproval(token, user.id, !user.approved); await refresh(); } finally { setBusy(null); } };
  return <AdminView title="사용자" meta={`${overview.users.length}명`}><section className="admin-panel admin-full-panel"><AdminPanelHeading title="사용자 관리" action={<input className="admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디 검색" aria-label="사용자 검색" />} /><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>사용자</th><th>상태</th><th>잔액</th><th>남은 롤링</th><th>베팅</th><th>전적</th><th>관리</th></tr></thead><tbody>{users.map((user) => <UserRow key={user.id} user={user} busy={busy === user.id} onToggle={() => void toggle(user)} />)}{users.length === 0 && <tr><td colSpan={7} className="admin-empty">검색 결과가 없습니다.</td></tr>}</tbody></table></div></section></AdminView>;
}

function UserRow({ user, busy, onToggle }: { user: AdminUser; busy: boolean; onToggle: () => void }) {
  return <tr><td><strong>{user.username}</strong><small className="admin-subline">{user.role === "admin" ? "관리자" : new Date(user.createdAt).toLocaleDateString("ko-KR")}</small></td><td><span className={`admin-status ${user.approved ? "live-status" : "muted-status"}`}>{user.approved ? "이용 중" : "정지"}</span></td><td>{COIN(user.balance)}</td><td><span className={user.wageringRemaining > 0 ? "admin-rolling-left" : "admin-rolling-done"}>{user.wageringRemaining > 0 ? COIN(user.wageringRemaining) : "완료"}</span></td><td>{user.totalBets.toLocaleString()}회</td><td>{user.wins}승 {user.losses}패</td><td>{user.role === "admin" ? <span className="admin-protected">보호됨</span> : <button className="admin-small-button" disabled={busy} onClick={onToggle}>{busy ? "처리 중" : user.approved ? "이용 정지" : "승인"}</button>}</td></tr>;
}
