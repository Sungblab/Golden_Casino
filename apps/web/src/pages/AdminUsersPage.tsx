import { useMemo, useState } from "react";
import type { AdminUser, PublicAuthUser } from "@golden/contracts";
import { useAdminData } from "../admin/AdminData";
import { adminAdjustBalance, adminDeleteUser, adminResetPassword, setAdminUserApproval, setAdminUserRole } from "../api";
import { AdminPanelHeading, AdminView } from "./AdminView";

const COIN = (value: number) => `${value.toLocaleString()}코인`;

function currentUserId(): string | null {
  try {
    return (JSON.parse(sessionStorage.getItem("golden.user") ?? "null") as PublicAuthUser | null)?.id ?? null;
  } catch {
    return null;
  }
}

export function AdminUsersPage() {
  const { token, overview, refresh } = useAdminData();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const selfId = currentUserId();
  if (!overview) return null;
  const users = useMemo(() => overview.users.filter((user) => user.username.toLowerCase().includes(query.trim().toLowerCase())), [overview.users, query]);
  const adminCount = overview.users.filter((user) => user.role === "admin").length;
  const toggle = async (user: AdminUser) => { setBusy(user.id); try { await setAdminUserApproval(token, user.id, !user.approved); await refresh(); } finally { setBusy(null); } };
  return <AdminView title="사용자" meta={`${overview.users.length}명`}><section className="admin-panel admin-full-panel"><AdminPanelHeading title="사용자 관리" action={<input className="admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디 검색" aria-label="사용자 검색" />} /><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>사용자</th><th>상태</th><th>잔액</th><th>남은 롤링</th><th>베팅</th><th>전적</th><th>관리</th></tr></thead><tbody>{users.map((user) => <UserRow key={user.id} token={token} user={user} busy={busy === user.id} isSelf={user.id === selfId} adminCount={adminCount} onToggle={() => void toggle(user)} onAdjusted={refresh} />)}{users.length === 0 && <tr><td colSpan={7} className="admin-empty">검색 결과가 없습니다.</td></tr>}</tbody></table></div></section></AdminView>;
}

function UserRow({ token, user, busy, isSelf, adminCount, onToggle, onAdjusted }: { token: string; user: AdminUser; busy: boolean; isSelf: boolean; adminCount: number; onToggle: () => void; onAdjusted: () => Promise<void> | void }) {
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(1000);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const resetPassword = async () => {
    if (!window.confirm(`${user.username}님의 비밀번호를 임시 비밀번호로 초기화할까요? 기존 비밀번호는 즉시 사용할 수 없게 됩니다.`)) return;
    setResetting(true);
    try {
      const result = await adminResetPassword(token, user.id);
      setTempPassword(result.tempPassword);
    } finally {
      setResetting(false);
    }
  };
  const adjust = async (sign: 1 | -1) => {
    if (!Number.isInteger(adjustAmount) || adjustAmount <= 0) return;
    setAdjusting(true);
    setAdjustError(null);
    try {
      await adminAdjustBalance(token, user.id, adjustAmount * sign);
      await onAdjusted();
    } catch (caught) {
      setAdjustError(caught instanceof Error ? caught.message : "잔액 조정에 실패했습니다.");
    } finally {
      setAdjusting(false);
    }
  };
  const setRole = async (role: "user" | "admin") => {
    const confirmMessage = role === "admin"
      ? `${user.username}님에게 관리자 권한을 부여할까요? 관리자 페이지 전체에 접근할 수 있게 됩니다.`
      : `${user.username}님의 관리자 권한을 해제할까요?`;
    if (!window.confirm(confirmMessage)) return;
    setRoleBusy(true);
    try {
      await setAdminUserRole(token, user.id, role);
      await onAdjusted();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "권한 변경에 실패했습니다.");
    } finally {
      setRoleBusy(false);
    }
  };
  const deleteUser = async () => {
    if (!window.confirm(`${user.username}님을 탈퇴 처리할까요?\n\n로그인이 영구적으로 막히고 아이디/닉네임은 다른 사람이 다시 쓸 수 있게 바뀝니다. 베팅·충환전 기록은 감사를 위해 그대로 남지만, 이 화면에서는 목록에서 사라지며 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      await adminDeleteUser(token, user.id);
      await onAdjusted();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "탈퇴 처리에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };
  return (
    <tr>
      <td><strong>{user.username}</strong><small className="admin-subline">{user.role === "admin" ? "관리자" : new Date(user.createdAt).toLocaleDateString("ko-KR")}</small></td>
      <td><span className={`admin-status ${user.approved ? "live-status" : "muted-status"}`}>{user.approved ? "이용 중" : "정지"}</span></td>
      <td>{COIN(user.balance)}</td>
      <td><span className={user.wageringRemaining > 0 ? "admin-rolling-left" : "admin-rolling-done"}>{user.wageringRemaining > 0 ? COIN(user.wageringRemaining) : "완료"}</span></td>
      <td>{user.totalBets.toLocaleString()}회</td>
      <td>{user.wins}승 {user.losses}패</td>
      <td>
        {user.role === "admin" ? (
          isSelf ? (
            <span className="admin-protected">내 계정</span>
          ) : (
            <div className="admin-user-actions">
              <button className="admin-small-button" disabled={roleBusy || adminCount <= 1} title={adminCount <= 1 ? "마지막 관리자는 해제할 수 없습니다." : undefined} onClick={() => void setRole("user")}>{roleBusy ? "처리 중" : "관리자 해제"}</button>
            </div>
          )
        ) : (
          <div className="admin-user-actions">
            <button className="admin-small-button" disabled={busy} onClick={onToggle}>{busy ? "처리 중" : user.approved ? "이용 정지" : "승인"}</button>
            <button className="admin-small-button" disabled={resetting} onClick={() => void resetPassword()}>{resetting ? "처리 중" : "비번 초기화"}</button>
            <button className="admin-small-button" disabled={roleBusy} onClick={() => void setRole("admin")}>{roleBusy ? "처리 중" : "관리자 지정"}</button>
            <div className="admin-balance-adjust">
              <button type="button" className="admin-small-button" disabled={adjusting} onClick={() => void adjust(-1)} aria-label="코인 차감" title="코인 차감">－</button>
              <input type="number" className="admin-balance-input" min={1} step={100} value={adjustAmount} disabled={adjusting} onChange={(event) => setAdjustAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))} aria-label="조정할 코인 수" />
              <button type="button" className="admin-small-button" disabled={adjusting} onClick={() => void adjust(1)} aria-label="코인 지급" title="코인 지급">＋</button>
            </div>
            <button className="admin-small-button reject" disabled={deleting} onClick={() => void deleteUser()}>{deleting ? "처리 중" : "탈퇴 처리"}</button>
            {adjustError && <small className="error-message">{adjustError}</small>}
            {tempPassword && <div className="admin-temp-password"><span>임시 비밀번호: <code>{tempPassword}</code></span><button type="button" className="admin-temp-password-close" onClick={() => setTempPassword(null)} aria-label="닫기">×</button></div>}
          </div>
        )}
      </td>
    </tr>
  );
}
