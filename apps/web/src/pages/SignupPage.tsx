import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { register } from "../api";

export function SignupPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (username.trim().length < 2) return setError("아이디는 2자 이상 입력해주세요.");
    if (nickname.trim().length < 2) return setError("닉네임은 2자 이상 입력해주세요.");
    if (password.length < 8) return setError("비밀번호는 8자 이상 입력해주세요.");
    if (password !== passwordConfirm) return setError("비밀번호가 일치하지 않습니다.");
    setBusy(true);
    try {
      await register(username.trim(), nickname.trim(), password);
      navigate("/login", { replace: true, state: { notice: "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있어요." } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회원가입에 실패했습니다.");
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
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="로그인에 사용할 아이디" />
          </label>
          <label>
            닉네임
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="nickname" placeholder="게임/채팅에 표시될 이름" />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <label>
            비밀번호 확인
            <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="error-message">{error}</p>}
          <button className="gold-button" disabled={busy}>
            {busy ? "신청 중…" : "회원가입 신청"}
          </button>
        </form>
        <p className="login-signup-link">
          이미 계정이 있으신가요? <Link to="/login">로그인</Link>
        </p>
      </section>
    </main>
  );
}
