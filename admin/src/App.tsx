import { useState } from "react";
import { clearAdminKey, loadAdminKey, saveAdminKey } from "./adminKey";
import { KeyGate } from "./components/KeyGate";
import { HealthBadge } from "./components/HealthBadge";
import { DocumentsPage } from "./pages/DocumentsPage";
import { ChatPage } from "./pages/ChatPage";
import { VoicePage } from "./pages/VoicePage";

const TABS = [
  { id: "documents", label: "Documents" },
  { id: "chat", label: "Test text chat" },
  { id: "voice", label: "Test voice" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Top level: no key → the key screen; with a key → header, tabs and pages.
 *
 * All pages stay mounted and inactive ones are just hidden, so switching
 * tabs doesn't throw away a chat conversation or a running upload.
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
        <div hidden={tab !== "documents"}>
          <DocumentsPage adminKey={adminKey} />
        </div>
        <div hidden={tab !== "chat"}>
          <ChatPage />
        </div>
        <div hidden={tab !== "voice"}>
          <VoicePage active={tab === "voice"} />
        </div>
      </main>
    </div>
  );
}
