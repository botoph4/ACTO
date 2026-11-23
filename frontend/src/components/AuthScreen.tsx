import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { login } from "../api";
import type { AuthUser } from "../types";

type Props = {
  onAuthenticated: (user: AuthUser) => void;
};

export default function AuthScreen({ onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setIsSubmitting(true);
    setError("");
    try {
      onAuthenticated(await login(username.trim(), password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-mark">A</div>
          <div>
            <span>ACTO · Cycle Studio</span>
            <h1>登录工作台</h1>
          </div>
        </div>
        <p className="auth-description">
          公司局域网协作版。每个账号拥有独立的浏览器工作表和登录会话。
        </p>
        <form onSubmit={submit}>
          <label>
            <span>账号</span>
            <div className="auth-input">
              <UserRound size={16} />
              <input
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入账号"
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="auth-input">
              <LockKeyhole size={16} />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
              />
            </div>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button
            className="auth-submit"
            type="submit"
            disabled={isSubmitting || !username.trim() || !password}
          >
            {isSubmitting ? "正在登录…" : "进入工作台"}
            {!isSubmitting && <ArrowRight size={16} />}
          </button>
        </form>
        <footer>
          <i />
          已启用账号验证与会话保护
        </footer>
      </section>
      <div className="auth-orbit orbit-one" />
      <div className="auth-orbit orbit-two" />
    </main>
  );
}
