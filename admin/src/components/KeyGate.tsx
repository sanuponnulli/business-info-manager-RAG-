import { useState, type FormEvent } from "react";
import { ApiError, listDocuments } from "../api";

/**
 * The "login" screen. There are no user accounts: admins share the
 * server's ADMIN_API_KEY. We check the key by making a real admin request;
 * if the server accepts it, we're in.
 */
export function KeyGate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await listDocuments(key.trim());
      onUnlock(key.trim());
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That key was not accepted." : String((err as Error).message));
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <h1>Handbook Admin</h1>
        <p className="muted">Enter the server's admin key (ADMIN_API_KEY in server/.env).</p>
        <label htmlFor="admin-key">Admin key</label>
        <input
          id="admin-key"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={!key.trim() || checking}>
          {checking ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
