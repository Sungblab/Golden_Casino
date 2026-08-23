import { useState, type FormEvent } from "react";
import type { PublicAuthUser } from "@golden/contracts";
import { Brand } from "../components/Brand";
import { login } from "../api";

export function LoginPage({ onLogin }: { onLogin: (token: string, user: PublicAuthUser) => void }) {
  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(username, password);
      onLogin(result.token, result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <div className="login-rule" aria-hidden="true" />
        <form onSubmit={submit}>
          <label>
            아이디
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="error-message">{error}</p>}
          <button className="gold-button" disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
        <small className="demo-hint">개발 계정: demo / demo1234 · 관리자: admin / admin1234</small>
      </section>
    </main>
  );
}
