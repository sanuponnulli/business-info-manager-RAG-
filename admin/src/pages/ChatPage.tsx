import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ask, type ChatTurn, type Source } from "../api";

/** The server accepts at most 20 turns of history. */
const MAX_HISTORY = 20;

interface Message {
  id: number;
  role: "user" | "model";
  text: string;
  sources?: Source[];
  ms?: number;
  error?: boolean;
}

/**
 * Tries /api/v1/chat/ask the way the Flutter app will use it. The server
 * keeps no conversation state, so every request carries the earlier turns
 * as `history`; that's what makes follow-up questions work.
 */
export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. (Block body on purpose: an effect may only
  // return a cleanup function, and newer browsers make scrollIntoView return a Promise.)
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    // History = earlier successful turns, without sources (the server only needs the text).
    const history: ChatTurn[] = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, text: m.text }))
      .slice(-MAX_HISTORY);

    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: question }]);
    setInput("");
    setBusy(true);

    const started = performance.now();
    try {
      const { answer, sources } = await ask(question, history);
      const ms = Math.round(performance.now() - started);
      setMessages((prev) => [...prev, { id: nextId.current++, role: "model", text: answer, sources, ms }]);
    } catch (err) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: "model", text: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  // Enter sends; Shift+Enter makes a new line.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className="card chat">
      <div className="row">
        <div>
          <h2>Test text chat</h2>
          <p className="muted">
            Ask the way an employee would. Answers come only from the uploaded handbooks; follow-ups use the conversation
            so far.
          </p>
        </div>
        <button className="secondary" onClick={() => setMessages([])} disabled={messages.length === 0 || busy}>
          New conversation
        </button>
      </div>

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <p className="muted empty">Try “How many sick days do I get?” or “What is the dress code?”</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}${m.error ? " failed" : ""}`}>
            <p className="bubble-text">{m.text}</p>
            {m.ms !== undefined && <p className="meta">{(m.ms / 1000).toFixed(1)}s</p>}
            {m.sources && m.sources.length > 0 && <SourceList sources={m.sources} />}
          </div>
        ))}
        {busy && <div className="bubble model pending">Searching the handbook and writing an answer…</div>}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={send}>
        <textarea
          aria-label="Question"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question about the handbook…"
          maxLength={2000}
        />
        <button type="submit" disabled={!input.trim() || busy}>
          Send
        </button>
      </form>
    </section>
  );
}

/**
 * The passages retrieved for an answer. Cited ones ([n] appears in the
 * answer) are highlighted; each can be expanded to read the passage.
 */
function SourceList({ sources }: { sources: Source[] }) {
  return (
    <details className="sources">
      <summary>
        Sources: {sources.filter((s) => s.cited).length} cited of {sources.length} retrieved
      </summary>
      <ol>
        {sources.map((s) => (
          <li key={s.n} className={s.cited ? "cited" : ""}>
            <details>
              <summary>
                <span className="badge">[{s.n}]</span> {s.title}, p. {s.page}
                <span className="muted"> · score {s.score.toFixed(3)}</span>
                {s.cited && <span className="cited-tag">cited</span>}
              </summary>
              <blockquote>{s.text}</blockquote>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
