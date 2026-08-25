import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProfileResponse } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { changePassword, getProfile } from "../api";

export function ProfilePage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState("");

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const reload = () => getProfile(token).then(setProfile).catch((caught) => setError(caught instanceof Error ? caught.message : "프로필을 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword.length < 8) return setPasswordError("새 비밀번호는 8자 이상 입력해주세요.");
    if (newPassword !== newPasswordConfirm) return setPasswordError("새 비밀번호가 일치하지 않습니다.");
    setPasswordBusy(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      onLogout();
      navigate("/login", { replace: true, state: { notice: "비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요." } });
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setPasswordBusy(false);
    }
  };

  if (!profile) return <div className="loading-screen"><p>{error || "프로필을 불러오는 중…"}</p></div>;
  const { stats } = profile;
  return (
    <AppShell balance={profile.walletBalance} onLogout={onLogout}>
      <section className="profile-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby">
            <span aria-hidden="true">←</span> 게임 로비
          </Link>
          <h1>{profile.user.nickname}</h1>
        </div>
      </section>

      <section className="profile-stats" aria-label="게임 통계">
        <ProfileStat label="총 베팅" value={`${stats.totalWagered.toLocaleString()}코인`} />
        <ProfileStat label="승리" value={`${stats.wins}회`} tone="positive" />
        <ProfileStat label="패배" value={`${stats.losses}회`} tone="negative" />
        <ProfileStat label="순손익" value={`${stats.netResult >= 0 ? "+" : ""}${stats.netResult.toLocaleString()}코인`} tone={stats.netResult >= 0 ? "positive" : "negative"} />
      </section>

      <section className="profile-panel profile-actions-panel">
        <div className="profile-panel-heading"><h2>계정 관리</h2></div>
        <div className="profile-actions single">
          <ActionButton active={showPasswordForm} onClick={() => setShowPasswordForm((value) => !value)} title="비밀번호 변경" description="현재 비밀번호 확인 후 변경" />
        </div>
        {showPasswordForm && (
          <form className="profile-form password" onSubmit={submitPasswordChange}>
            <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
            <label>새 비밀번호<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
            <label>새 비밀번호 확인<input type="password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
            {passwordError && <p className="error-message">{passwordError}</p>}
            <button className="gold-button" disabled={passwordBusy}>{passwordBusy ? "변경 중…" : "비밀번호 변경"}</button>
          </form>
        )}
      </section>
    </AppShell>
  );
}

function ProfileStat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`profile-stat ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function ActionButton({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`profile-action ${active ? "active" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>;
}
