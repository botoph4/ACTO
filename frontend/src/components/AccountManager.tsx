import { Plus, ShieldCheck, UserPlus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createUser, deleteUser, fetchUsers } from "../api";
import type { AuthUser, ManagedUser } from "../types";

type Props = {
  currentUser: AuthUser;
  onClose: () => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
};

export default function AccountManager({
  currentUser,
  onClose,
  onNotify,
}: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const load = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError("");
    try {
      setUsers(await fetchUsers());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取账号列表");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load(false);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const presenceLabel = (user: ManagedUser) => {
    if (user.is_online) return "在线";
    if (!user.last_seen_at) return "从未登录";
    const minutes = Math.max(
      1,
      Math.floor((Date.now() / 1000 - user.last_seen_at) / 60),
    );
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsCreating(true);
    setError("");
    try {
      const user = await createUser({
        username: username.trim(),
        display_name: displayName.trim(),
        password,
        role,
      });
      setUsers((current) => [
        ...current,
        { ...user, last_seen_at: null, is_online: false },
      ]);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      onNotify(`账号 ${user.username} 已创建`, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账号创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (user: AuthUser) => {
    if (
      !window.confirm(
        `删除账号“${user.display_name}（@${user.username}）”？该账号的登录会话也会立即失效。`,
      )
    ) {
      return;
    }
    setError("");
    try {
      await deleteUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      onNotify(`账号 ${user.username} 已删除`, "info");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账号删除失败");
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <span className="eyebrow">管理员设置</span>
            <h2 id="account-dialog-title">账号与访问</h2>
          </div>
          <button type="button" className="dialog-close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="account-dialog-body">
          <section className="account-create">
            <header>
              <span>
                <UserPlus size={15} />
                新建账号
              </span>
              <small>密码至少 8 位</small>
            </header>
            <form onSubmit={submit}>
              <label>
                <span>登录账号</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="例如 zhangsan"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>显示名称</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如 张三"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>初始密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>权限</span>
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as "user" | "admin")
                  }
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={
                  isCreating ||
                  username.trim().length < 3 ||
                  password.length < 8
                }
              >
                <Plus size={14} />
                {isCreating ? "正在创建" : "创建账号"}
              </button>
            </form>
          </section>
          <section className="account-list">
            <header>
              <span>
                <ShieldCheck size={15} />
                可登录账号
              </span>
              <small>
                在线 {users.filter((user) => user.is_online).length} /{" "}
                {users.length}
              </small>
            </header>
            {isLoading ? (
              <p>正在读取…</p>
            ) : (
              users.map((user) => (
                <article key={user.id}>
                  <span>{user.display_name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{user.display_name}</strong>
                    <small>@{user.username}</small>
                    <span
                      className={`account-presence ${
                        user.is_online ? "online" : ""
                      }`}
                    >
                      <i />
                      {presenceLabel(user)}
                    </span>
                  </div>
                  <em className={user.role}>
                    {user.role === "admin" ? "管理员" : "普通用户"}
                  </em>
                  {user.id === currentUser.id ? (
                    <b>当前</b>
                  ) : (
                    <button
                      type="button"
                      className="account-delete"
                      title={`删除账号 ${user.username}`}
                      aria-label={`删除账号 ${user.username}`}
                      onClick={() => void remove(user)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </article>
              ))
            )}
          </section>
        </div>
        {error && <div className="account-error">{error}</div>}
        <footer className="account-dialog-footer">
          普通用户可创建自己的工作表并访问排程；管理员可继续创建账号。
        </footer>
      </section>
    </div>
  );
}
