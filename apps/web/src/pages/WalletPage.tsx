import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { COIN_SCALE, type CashRequest, type ClientToServerEvents, type ProfileResponse, type ServerToClientEvents } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { API_URL, createCashRequest, createTransfer, getProfile } from "../api";
import { TRANSACTION_LABEL as TYPE_LABEL } from "../lib/transactionLabels";

type Action = "deposit" | "withdraw" | "transfer" | null;

export function WalletPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => getProfile(token).then(setProfile).catch((caught) => setError(caught instanceof Error ? caught.message : "지갑 정보를 불러오지 못했습니다."));
  useEffect(() => { void reload(); }, [token]);

  // Admin decisions on cash requests happen out of band, so this page needs a live push
  // to reflect the new balance/status without a manual reload.
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);
  useEffect(() => {
    const onWalletUpdated = () => void reload();
    const onNotification = (payload: { type: "success" | "error" | "info"; message: string }) => {
      if (payload.type === "error") setError(payload.message); else setMessage(payload.message);
    };
    socket.on("wallet.updated", onWalletUpdated);
    socket.on("notification", onNotification);
    socket.connect();
    return () => {
      socket.off("wallet.updated", onWalletUpdated);
      socket.off("notification", onNotification);
      socket.disconnect();
    };
  }, [socket]);

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
        if (!recipient.trim()) throw new Error("받는 사람 닉네임을 입력해주세요.");
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

  const items = profile?.transactions ?? [];
  const summary = useMemo(() => {
    const amounts = items.map((item) => Math.round(item.amount_minor / COIN_SCALE));
    const incoming = amounts.filter((amount) => amount > 0).reduce((total, amount) => total + amount, 0);
    const outgoing = amounts.filter((amount) => amount < 0).reduce((total, amount) => total + Math.abs(amount), 0);
    return { incoming, outgoing, net: incoming - outgoing };
  }, [items]);

  if (!profile) return <div className="loading-screen"><p>{error || "지갑 정보를 불러오는 중…"}</p></div>;
  const outgoingLocked = !profile.wagering.canWithdraw;
  const balance = profile.walletBalance;

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="wallet-heading">
        <div className="wallet-title-group">
          <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>지갑</h1>
        </div>
      </div>
      <section className="wallet-summary" aria-label="거래 요약">
        <div className="wallet-stat"><small>현재 잔액</small><strong>{balance.toLocaleString()}코인</strong></div>
        <div className="wallet-stat positive"><small>입금 합계</small><strong>+{summary.incoming.toLocaleString()}코인</strong></div>
        <div className="wallet-stat negative"><small>출금 합계</small><strong>-{summary.outgoing.toLocaleString()}코인</strong></div>
        <div className={`wallet-stat ${summary.net >= 0 ? "positive" : "negative"}`}><small>순변동</small><strong>{summary.net >= 0 ? "+" : ""}{summary.net.toLocaleString()}코인</strong></div>
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
            {action === "transfer" && <label>받는 사람 닉네임<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="닉네임 입력" autoComplete="off" list="recipient-list" /><datalist id="recipient-list">{profile.recipients.map((entry) => <option key={entry.nickname} value={entry.nickname} />)}</datalist></label>}
            <label>{action === "deposit" ? "충전 신청 금액" : action === "withdraw" ? "환전 신청 금액" : "송금 금액"}<input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="코인 수량" /></label>
            <button className="gold-button" disabled={busy || (action !== "deposit" && outgoingLocked)}>{busy ? "처리 중…" : action === "deposit" ? "충전 신청" : outgoingLocked ? `롤링 ${profile.wagering.remaining.toLocaleString()}코인 남음` : action === "withdraw" ? "환전 신청" : "송금하기"}</button>
          </form>
        )}
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error-message">{error}</p>}
      </section>

      <section className="profile-panel">
        <div className="profile-panel-heading"><h2>충전·환전 신청 내역</h2></div>
        {profile.cashRequests.length === 0 ? <p className="muted">아직 신청 내역이 없습니다.</p> : <div className="request-list">{profile.cashRequests.map((request) => <CashRequestRow key={request.id} request={request} />)}</div>}
      </section>

      {!items.length && <p className="muted">아직 기록이 없습니다. 테이블에서 첫 베팅을 해보세요.</p>}
      {items.length > 0 && (
        <div className="wallet-table-wrap">
          <table className="wallet-table">
            <thead>
              <tr>
                <th>일시</th>
                <th>내역</th>
                <th>구분</th>
                <th className="align-right">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const rowAmount = Math.round(item.amount_minor / COIN_SCALE);
                return (
                  <tr key={item.id + item.created_at + rowAmount}>
                    <td>{formatTransactionDate(item.created_at)}</td>
                    <td>{TYPE_LABEL[item.transaction_type] ?? item.transaction_type}</td>
                    <td className="muted">{item.reference_type ?? "-"}</td>
                    <td className={`align-right ${rowAmount >= 0 ? "amount-positive" : "amount-negative"}`}>
                      {rowAmount >= 0 ? "+" : ""}
                      {rowAmount.toLocaleString()}코인
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function formatTransactionDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ActionButton({ title, description, active, onClick }: { title: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`profile-action ${active ? "active" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>;
}

function CashRequestRow({ request }: { request: CashRequest }) {
  const labels = { deposit: "충전", withdraw: "환전" } as const;
  const statuses = { pending: "처리 대기", approved: "승인", rejected: "거절", cancelled: "취소" } as const;
  return <div className="ledger-row"><span>{labels[request.type]} <small>{statuses[request.status]}</small></span><strong>{request.amount.toLocaleString()}코인</strong></div>;
}
