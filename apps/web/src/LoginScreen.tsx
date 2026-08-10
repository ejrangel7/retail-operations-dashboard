import { useState } from "react";

type Props = {
  submitting: boolean;
  error: string;
  onSubmit: (email: string, password: string) => Promise<void>;
};

export function LoginScreen({ submitting, error, onSubmit }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark">RO</span><span>Retail Ops</span></div>
        <p className="eyebrow">Secure operations workspace</p>
        <h1 id="login-title">Sign in</h1>
        <p className="login-intro">Use the fictional read-only account to explore the public dashboard.</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <form className="login-form" aria-label="Sign in" onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit(email, password);
        }}>
          <label>Email
            <input type="email" autoComplete="username" value={email}
              onChange={(event) => setEmail(event.target.value)} placeholder="viewer@retail.local" required />
          </label>
          <label>Password
            <input type="password" autoComplete="current-password" value={password}
              onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary-button login-submit" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <div className="demo-accounts" aria-label="Demo accounts">
          <p><strong>Viewer</strong><span>viewer@retail.local / RetailView!2026</span></p>
        </div>
        <p className="login-disclaimer">Operator access is restricted to local development.</p>
      </section>
    </main>
  );
}
