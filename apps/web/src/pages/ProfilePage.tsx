import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CashRequest, ProfileResponse } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { createCashRequest, createTransfer, getProfile } from "../api";
import { TRANSACTION_LABEL } from "../lib/transactionLabels";

type Action = "deposit" | "withdraw" | "transfer" | null;

export function ProfilePage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => getProfile(token).then(setProfile).catch((caught) => setError(caught instanceof Error ? caught.message : "프로필을 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      setError("금액을 코인 단위로 입력해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "transfer") {
        if (!recipient.trim()) throw new Error("받는 사람 아이디를 입력해주세요.");
        const result = await createTransfer(token, recipient.trim(), numericAmount);
        setMessage(result.duplicate ? "이미 처리된 송금 요청입니다." : `${recipient.trim()}님에게 ${numericAmount.toLocaleString()}코인을 송금했습니다.`);
      } else if (action) {
        await createCashRequest(token, action, numericAmount);
        setMessage(`${action === "deposit" ? "충전" : "환전"} 신청이 접수되었습니다. 관리자 확인 후 처리됩니다.`);
      }
      setAmount("");
      setRecipient("");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return <div className="loading-screen"><p>{error || "프로필을 불러오는 중…"}</p></div>;
  const { stats } = profile;
  const outgoingLocked = !profile.wagering.canWithdraw;
  return (
    <AppShell balance={profile.walletBalance} onLogout={onLogout}>
      <section className="profile-heading">
        <div className="profile-title-group">
          <Link className="lobby-return-button profile-lobby-link" to="/lobby">
            <span aria-hidden="true">←</span> 게임 로비
          </Link>
          <h1>{profile.user.username}</h1>
        </div>
      </section>

      <section className="profile-stats" aria-label="게임 통계">
        <ProfileStat label="총 베팅" value={`${stats.totalWagered.toLocaleString()}코인`} />
        <ProfileStat label="승리" value={`${stats.wins}회`} tone="positive" />
        <ProfileStat label="패배" value={`${stats.losses}회`} tone="negative" />
        <ProfileStat label="순손익" value={`${stats.netResult >= 0 ? "+" : ""}${stats.netResult.toLocaleString()}코인`} tone={stats.netResult >= 0 ? "positive" : "negative"} />
      </section>

      <section className="profile-panel profile-actions-panel">
        <div className="profile-panel-heading"><h2>코인 관리</h2></div>
        <div className={`wagering-progress-card ${outgoingLocked ? "is-active" : "is-complete"}`}>
          <div><strong>환전 롤링</strong><span>{outgoingLocked ? `${profile.wagering.remaining.toLocaleString()}코인 남음` : "환전 가능"}</span></div>
          <div className="wagering-progress-track" aria-label={`롤링 진행률 ${profile.wagering.progressPercent}%`}><i style={{ width: `${profile.wagering.progressPercent}%` }} /></div>
          <small>{profile.wagering.required === 0 ? "승인된 충전부터 100% 베팅 조건이 적용됩니다." : `${profile.wagering.completed.toLocaleString()} / ${profile.wagering.required.toLocaleString()}코인 · ${profile.wagering.progressPercent}%`}</small>
        </div>
        <div className="profile-actions">
          <ActionButton active={action === "deposit"} onClick={() => setAction(action === "deposit" ? null : "deposit")} title="충전 신청" description="관리자 확인 후 잔액에 반영" />
          <ActionButton active={action === "withdraw"} onClick={() => setAction(action === "withdraw" ? null : "withdraw")} title="환전 신청" description={outgoingLocked ? `롤링 ${profile.wagering.remaining.toLocaleString()}코인 남음` : "보유 코인을 환전 요청"} />
          <ActionButton active={action === "transfer"} onClick={() => setAction(action === "transfer" ? null : "transfer")} title="개인 송금" description={outgoingLocked ? "롤링 완료 후 이용 가능" : "다른 사용자에게 코인 전송"} />
        </div>
        {action && (
          <form className={`profile-form ${action}`} onSubmit={submit}>
            {action === "transfer" && <label>받는 사람 아이디<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="아이디 입력" autoComplete="off" list="recipient-list" /><datalist id="recipient-list">{profile.recipients.map((entry) => <option key={entry.username} value={entry.username} />)}</datalist></label>}
            <label>{action === "deposit" ? "충전 신청 금액" : action === "withdraw" ? "환전 신청 금액" : "송금 금액"}<input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="코인 수량" /></label>
            <button className="gold-button" disabled={busy || (action !== "deposit" && outgoingLocked)}>{busy ? "처리 중…" : action === "deposit" ? "충전 신청" : outgoingLocked ? `롤링 ${profile.wagering.remaining.toLocaleString()}코인 남음` : action === "withdraw" ? "환전 신청" : "송금하기"}</button>
          </form>
        )}
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error-message">{error}</p>}
      </section>

      <div className="profile-columns">
        <section className="profile-panel">
          <div className="profile-panel-heading"><h2>충전·환전 신청</h2></div>
          {profile.cashRequests.length === 0 ? <p className="muted">아직 신청 내역이 없습니다.</p> : <div className="request-list">{profile.cashRequests.map((request) => <CashRequestRow key={request.id} request={request} />)}</div>}
        </section>
        <section className="profile-panel">
          <div className="profile-panel-heading"><h2>최근 게임 기록</h2></div>
          {profile.transactions.length === 0 ? <p className="muted">아직 게임 기록이 없습니다.</p> : <div className="request-list">{profile.transactions.slice(0, 8).map((item) => <div className="ledger-row" key={`${item.id}-${item.amount_minor}`}><span>{TRANSACTION_LABEL[item.transaction_type] ?? item.transaction_type}</span><strong className={item.amount_minor >= 0 ? "amount-positive" : "amount-negative"}>{item.amount_minor >= 0 ? "+" : ""}{Math.round(item.amount_minor / 100).toLocaleString()}코인</strong></div>)}</div>}
        </section>
      </div>
    </AppShell>
  );
}

function ProfileStat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`profile-stat ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function ActionButton({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`profile-action ${active ? "active" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>;
}

function CashRequestRow({ request }: { request: CashRequest }) {
  const labels = { deposit: "충전", withdraw: "환전" } as const;
  const statuses = { pending: "처리 대기", approved: "승인", rejected: "거절", cancelled: "취소" } as const;
  return <div className="ledger-row"><span>{labels[request.type]} <small>{statuses[request.status]}</small></span><strong>{request.amount.toLocaleString()}코인</strong></div>;
}
