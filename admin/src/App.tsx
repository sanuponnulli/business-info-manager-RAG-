import { useState } from "react";
import { clearAdminKey, loadAdminKey, saveAdminKey } from "./adminKey";
import { KeyGate } from "./components/KeyGate";
import { HealthBadge } from "./components/HealthBadge";

const TABS = [
  { id: "documents", label: "Documents" },
  { id: "chat", label: "Test text chat" },
  { id: "voice", label: "Test voice" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Top level: no key → the key screen; with a key → header, tabs and the
 * selected page. The pages themselves arrive in chunks F2–F4.
 */
export function App() {
  const [adminKey, setAdminKey] = useState<string | null>(loadAdminKey);
  const [tab, setTab] = useState<TabId>("documents");

  if (!adminKey) {
    return (
      <KeyGate
        onUnlock={(key) => {
          saveAdminKey(key);
          setAdminKey(key);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Handbook Admin</strong>
        <HealthBadge />
        <button
          className="link"
          onClick={() => {
            clearAdminKey();
            setAdminKey(null);
          }}
        >
          Lock
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="page">
        {tab === "documents" && <Placeholder title="Documents" chunk="F2" />}
        {tab === "chat" && <Placeholder title="Test text chat" chunk="F3" />}
        {tab === "voice" && <Placeholder title="Test voice" chunk="F4" />}
      </main>
    </div>
  );
}

function Placeholder({ title, chunk }: { title: string; chunk: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted">Coming in chunk {chunk}.</p>
    </section>
  );
}
