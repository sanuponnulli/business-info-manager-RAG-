import { useEffect, useRef, useState, type FormEvent } from "react";
import { MicRecorder } from "../audio/micRecorder";
import { PcmPlayer } from "../audio/pcmPlayer";
import { VoiceClient, type ServerMessage } from "../voice/voiceClient";

type Status = "disconnected" | "connecting" | "ready";

interface Entry {
  id: number;
  kind: "user" | "model" | "tool" | "info" | "error";
  text: string;
  /** Seconds from "end" (mic released) to the first reply audio. */
  latency?: number;
}

/**
 * Tries the voice agent (/ws/voice-agent) the way the Flutter app will:
 * connect, talk, hear the spoken reply, read the live captions.
 *
 * Mutable things that aren't drawn on screen (the socket, mic, player,
 * timers) live in refs; only what the UI shows lives in state.
 */
export function VoicePage({ active }: { active: boolean }) {
  const [status, setStatus] = useState<Status>("disconnected");
  const [recording, setRecording] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [typed, setTyped] = useState("");

  const client = useRef<VoiceClient | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const player = useRef(new PcmPlayer(24000, setAgentSpeaking));
  const nextId = useRef(1);
  /** The caption entry currently receiving fragments, per speaker. */
  const openEntry = useRef<{ user: number | null; model: number | null }>({ user: null, model: null });
  /** When the user finished their question; cleared once the first reply audio arrives. */
  const askedAt = useRef<number | null>(null);
  const latency = useRef<number | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  // --- log helpers ---

  function addEntry(kind: Entry["kind"], text: string): number {
    const id = nextId.current++;
    setEntries((prev) => [...prev, { id, kind, text }]);
    return id;
  }

  /** Captions arrive in fragments; glue them onto the speaker's open entry. */
  function appendCaption(role: "user" | "model", text: string) {
    const open = openEntry.current[role];
    if (open === null) {
      openEntry.current[role] = addEntry(role, text);
    } else {
      setEntries((prev) => prev.map((e) => (e.id === open ? { ...e, text: e.text + text } : e)));
    }
  }

  function finishTurn() {
    const modelId = openEntry.current.model;
    const secs = latency.current;
    if (modelId !== null && secs !== null) {
      setEntries((prev) => prev.map((e) => (e.id === modelId ? { ...e, latency: secs } : e)));
    }
    openEntry.current = { user: null, model: null };
    latency.current = null;
  }

  // --- server messages ---

  function onMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "ready":
        setStatus("ready");
        addEntry("info", "Connected. Press “Start talking”, ask a question, then “Stop & send”.");
        break;
      case "audio":
        if (askedAt.current !== null) {
          latency.current = (performance.now() - askedAt.current) / 1000;
          askedAt.current = null;
        }
        player.current.enqueue(msg.data);
        break;
      case "transcript":
        appendCaption(msg.role, msg.text);
        break;
      case "tool":
        addEntry("tool", `Searching the handbook: “${msg.query}”`);
        break;
      case "interrupted":
        player.current.stop(); // the user talked over the agent: stop its voice now
        addEntry("info", "Agent interrupted");
        finishTurn();
        break;
      case "turn_complete":
        finishTurn();
        break;
      case "error":
        addEntry("error", `${msg.code}: ${msg.message}`);
        break;
    }
  }

  // --- actions ---

  function connect() {
    player.current.unlock(); // we're inside a click, so the browser allows audio from now on
    setStatus("connecting");
    client.current = new VoiceClient({
      onMessage,
      onClose: (code, reason) => {
        client.current = null;
        setStatus("disconnected");
        void stopRecorder();
        player.current.stop();
        finishTurn();
        addEntry("info", `Disconnected (code ${code}${reason ? `: ${reason}` : ""})`);
      },
    });
  }

  function disconnect() {
    client.current?.close();
  }

  async function startTalking() {
    player.current.stop(); // talking over the agent: cut it off locally right away
    const mic = new MicRecorder((chunk) => client.current?.send({ type: "audio", data: chunk }), setLevel);
    try {
      await mic.start();
      recorder.current = mic;
      setRecording(true);
    } catch (err) {
      addEntry("error", `Microphone unavailable: ${(err as Error).message}`);
    }
  }

  async function stopRecorder() {
    const mic = recorder.current;
    recorder.current = null;
    setRecording(false);
    await mic?.stop();
  }

  async function stopTalking() {
    await stopRecorder();
    client.current?.send({ type: "end" }); // "I'm done": the server adds a pause and Gemini answers
    askedAt.current = performance.now();
  }

  function sendTyped(e: FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    player.current.stop();
    client.current?.send({ type: "text", text });
    addEntry("user", `⌨ ${text}`);
    askedAt.current = performance.now();
    setTyped("");
  }

  // Leaving the tab while talking: stop the mic (the connection stays open).
  useEffect(() => {
    if (!active && recorder.current) void stopTalking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Leaving the page entirely: release everything.
  useEffect(() => {
    const p = player.current;
    return () => {
      client.current?.close();
      void recorder.current?.stop();
      void p.close();
    };
  }, []);

  const ready = status === "ready";

  return (
    <section className="card voice">
      <div className="row">
        <div>
          <h2>Test voice</h2>
          <p className="muted">
            Talks to the same voice agent the Flutter app will use. Your browser will ask for microphone access.
          </p>
        </div>
        <div className="voice-connection">
          <span className={`pill pill-${status}`}>{status}</span>
          {status === "disconnected" ? (
            <button onClick={connect}>Connect</button>
          ) : (
            <button className="secondary" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="voice-controls">
        <button
          className={`talk${recording ? " recording" : ""}`}
          disabled={!ready}
          onClick={() => void (recording ? stopTalking() : startTalking())}
          aria-pressed={recording}
        >
          {recording ? "■ Stop & send" : "🎙 Start talking"}
        </button>
        <div className="level" aria-label="Microphone level">
          <div className="level-fill" style={{ width: `${Math.min(1, level * 4) * 100}%` }} />
        </div>
        <span className="muted speaking" aria-live="polite">
          {agentSpeaking ? "🔊 Agent speaking…" : recording ? "Listening…" : ""}
        </span>
      </div>

      <form className="composer" onSubmit={sendTyped}>
        <input
          aria-label="Type a message instead"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="…or type a message (the agent still answers out loud)"
          disabled={!ready}
          maxLength={2000}
        />
        <button type="submit" className="secondary" disabled={!ready || !typed.trim()}>
          Send
        </button>
      </form>

      <ol className="voice-log" aria-live="polite">
        {entries.length === 0 && <li className="muted">Press Connect to start a voice session.</li>}
        {entries.map((e) => (
          <li key={e.id} className={`entry entry-${e.kind}`}>
            <span className="who">{LABELS[e.kind]}</span>
            <span>
              {e.text}
              {e.latency !== undefined && <span className="meta"> · first audio after {e.latency.toFixed(1)}s</span>}
            </span>
          </li>
        ))}
        <div ref={logEnd} />
      </ol>
    </section>
  );
}

const LABELS: Record<Entry["kind"], string> = {
  user: "You",
  model: "Agent",
  tool: "🔎",
  info: "•",
  error: "⚠",
};
