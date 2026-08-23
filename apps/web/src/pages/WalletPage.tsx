import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { COIN_SCALE, type WalletTransactionItem } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { getLobby, getWalletTransactions } from "../api";

const TYPE_LABEL: Record<string, string> = {
  OPENING_BALANCE: "지급된 초기 코인",
  BET_RESERVED: "베팅 접수",
  BET_SETTLED: "라운드 정산",
  BET_REFUNDED: "라운드 중단 환불",
  BET_CANCELLED: "베팅 취소",
};

export function WalletPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [items, setItems] = useState<WalletTransactionItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getWalletTransactions(token), getLobby(token)])
      .then(([transactions, lobby]) => {
        setItems(transactions.items);
        setBalance(lobby.walletBalance);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "베팅 기록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [token]);

  const summary = useMemo(() => {
    const amounts = items.map((item) => item.amount_minor / COIN_SCALE);
    const incoming = amounts.filter((amount) => amount > 0).reduce((total, amount) => total + amount, 0);
    const outgoing = amounts.filter((amount) => amount < 0).reduce((total, amount) => total + Math.abs(amount), 0);
    return { incoming, outgoing, net: incoming - outgoing };
  }, [items]);

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="wallet-heading">
        <div className="wallet-title-group">
          <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>거래 내역</h1>
        </div>
      </div>
      <section className="wallet-summary" aria-label="거래 요약">
        <div className="wallet-stat"><small>현재 잔액</small><strong>{balance.toLocaleString()}코인</strong></div>
        <div className="wallet-stat positive"><small>입금 합계</small><strong>+{summary.incoming.toLocaleString()}코인</strong></div>
        <div className="wallet-stat negative"><small>출금 합계</small><strong>-{summary.outgoing.toLocaleString()}코인</strong></div>
        <div className={`wallet-stat ${summary.net >= 0 ? "positive" : "negative"}`}><small>순변동</small><strong>{summary.net >= 0 ? "+" : ""}{summary.net.toLocaleString()}코인</strong></div>
      </section>
      {loading && <p className="muted">불러오는 중…</p>}
      {error && <p className="error-message">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="muted">아직 기록이 없습니다. 테이블에서 첫 베팅을 해보세요.</p>}
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
                const amount = item.amount_minor / COIN_SCALE;
                return (
                  <tr key={item.id + item.created_at + amount}>
                    <td>{formatTransactionDate(item.created_at)}</td>
                    <td>{TYPE_LABEL[item.transaction_type] ?? item.transaction_type}</td>
                    <td className="muted">{item.reference_type ?? "-"}</td>
                    <td className={`align-right ${amount >= 0 ? "amount-positive" : "amount-negative"}`}>
                      {amount >= 0 ? "+" : ""}
                      {amount.toLocaleString()}코인
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
