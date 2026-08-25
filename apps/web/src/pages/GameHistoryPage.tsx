import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameHistoryItem, GameHistoryResponse, GameHistoryStats } from "@golden/contracts";
import { AppShell } from "../components/AppShell";
import { getGameHistory, getLobby } from "../api";
import { GAME_TYPE_LABEL, OUTCOME_LABEL } from "../lib/gameLabels";

export function GameHistoryPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [history, setHistory] = useState<GameHistoryResponse | null>(null);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getGameHistory(token), getLobby(token)])
      .then(([historyResult, lobby]) => {
        setHistory(historyResult);
        setBalance(lobby.walletBalance);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "게임 기록을 불러오지 못했습니다."));
  }, [token]);

  if (!history) return <div className="loading-screen"><p>{error || "게임 기록을 불러오는 중…"}</p></div>;

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className="wallet-heading">
        <div className="wallet-title-group">
          <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>게임 기록</h1>
        </div>
      </div>

      <section className="wallet-summary" aria-label="전체 통계">
        <StatTile label="총 베팅" value={`${history.overall.totalWagered.toLocaleString()}코인`} />
        <StatTile label="승리" value={`${history.overall.wins}회`} tone="positive" />
        <StatTile label="패배" value={`${history.overall.losses}회`} tone="negative" />
        <StatTile label="순손익" value={`${history.overall.net >= 0 ? "+" : ""}${history.overall.net.toLocaleString()}코인`} tone={history.overall.net >= 0 ? "positive" : "negative"} />
      </section>

      {history.byGame.length > 0 && (
        <section className="profile-panel">
          <div className="profile-panel-heading"><h2>게임별 통계</h2></div>
          <div className="game-history-bygame">
            {history.byGame.map((row) => <GameStatRow key={row.game} row={row} />)}
          </div>
        </section>
      )}

      <section className="profile-panel">
        <div className="profile-panel-heading"><h2>베팅 기록</h2></div>
        {history.items.length === 0 ? (
          <p className="muted">아직 베팅 기록이 없습니다. 테이블에서 첫 베팅을 해보세요.</p>
        ) : (
          <div className="wallet-table-wrap">
            <table className="wallet-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>게임</th>
                  <th>선택</th>
                  <th className="align-right">베팅</th>
                  <th>결과</th>
                  <th className="align-right">손익</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => <GameHistoryRow key={item.id} item={item} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function StatTile({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`wallet-stat ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function GameStatRow({ row }: { row: GameHistoryStats & { game: GameHistoryItem["game"] } }) {
  return (
    <div className="game-history-bygame-row">
      <strong>{GAME_TYPE_LABEL[row.game]}</strong>
      <span>{row.totalWagered.toLocaleString()}코인 베팅</span>
      <span>{row.wins}승 {row.losses}패{row.pushes > 0 ? ` ${row.pushes}무` : ""}</span>
      <strong className={row.net >= 0 ? "amount-positive" : "amount-negative"}>{row.net >= 0 ? "+" : ""}{row.net.toLocaleString()}코인</strong>
    </div>
  );
}

function GameHistoryRow({ item }: { item: GameHistoryItem }) {
  return (
    <tr>
      <td>{formatDate(item.createdAt)}</td>
      <td>{GAME_TYPE_LABEL[item.game]} <small className="muted">{item.roomName}</small></td>
      <td>{item.choiceLabel}</td>
      <td className="align-right">{item.amount.toLocaleString()}코인</td>
      <td>{item.outcome ? OUTCOME_LABEL[item.outcome] ?? item.outcome : "-"}</td>
      <td className={`align-right ${item.net >= 0 ? "amount-positive" : "amount-negative"}`}>{item.net >= 0 ? "+" : ""}{item.net.toLocaleString()}코인</td>
    </tr>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
