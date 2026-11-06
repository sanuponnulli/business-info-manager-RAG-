import { useEffect, useState } from "react";
import { getHealth } from "../api";

type State = "checking" | "ok" | "degraded" | "offline";

const LABELS: Record<State, string> = {
  checking: "Checking server…",
  ok: "Server and ChromaDB OK",
  degraded: "ChromaDB is down",
  offline: "Server unreachable",
};

/** A small status light in the header, refreshed every 10 seconds. */
export function HealthBadge() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await getHealth();
        if (!cancelled) setState(health.status === "ok" ? "ok" : "degraded");
      } catch {
        if (!cancelled) setState("offline");
      }
    };
    void check();
    const timer = setInterval(check, 10_000);
    // Cleanup when the component goes away: stop polling.
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <span className={`health health-${state}`} title={LABELS[state]}>
      <span className="dot" aria-hidden /> {LABELS[state]}
    </span>
  );
}
