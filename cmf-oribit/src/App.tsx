
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type GestureType =
  | "ROTATE_CW"
  | "ROTATE_CCW"
  | "PRESS_SINGLE_TOGGLE"
  | "PRESS_SINGLE_PLAY"
  | "PRESS_SINGLE_PAUSE"
  | "PRESS_DOUBLE"
  | "PRESS_TRIPLE";

type DialEvent = {
  type: GestureType;
};

type GestureLog = {
  id: number;
  type: GestureType;
  time: string;
  action: string;
};

const gestures: {
  type: GestureType;
  label: string;
  description: string;
}[] = [
  { type: "ROTATE_CW", label: "Rotate clockwise", description: "Dial rotation →" },
  { type: "ROTATE_CCW", label: "Rotate counter-clockwise", description: "Dial rotation ←" },
  { type: "PRESS_SINGLE_TOGGLE", label: "Toggle playback", description: "Single press · toggle" },
  { type: "PRESS_SINGLE_PLAY", label: "Play", description: "Single press · play command" },
  { type: "PRESS_SINGLE_PAUSE", label: "Pause", description: "Single press · pause command" },
  { type: "PRESS_DOUBLE", label: "Double press", description: "Next-track command" },
  { type: "PRESS_TRIPLE", label: "Triple press", description: "Previous-track command" },
];

const defaultActions: Record<GestureType, string> = {
  ROTATE_CW: "Not configured",
  ROTATE_CCW: "Not configured",
  PRESS_SINGLE_TOGGLE: "Toggle playback",
  PRESS_SINGLE_PLAY: "Play media",
  PRESS_SINGLE_PAUSE: "Pause media",
  PRESS_DOUBLE: "Next track",
  PRESS_TRIPLE: "Previous track",
};

const actionOptions = [
  "Not configured",
  "Show gesture",
  "Volume up",
  "Volume down",
  "Play media",
  "Pause media",
  "Toggle playback",
  "Next track",
  "Previous track",
];

const wheelActions = [
  { label: "Screenshot", icon: "▣", detail: "Capture your screen" },
  { label: "Copy", icon: "▢", detail: "Copy selection" },
  { label: "Paste", icon: "▤", detail: "Paste clipboard" },
  { label: "Volume up", icon: "＋", detail: "Increase volume" },
  { label: "Play / pause", icon: "▶", detail: "Control playback" },
  { label: "Next track", icon: "≫", detail: "Skip forward" },
  { label: "Launch app", icon: "⌘", detail: "Open an app" },
  { label: "Volume down", icon: "－", detail: "Decrease volume" },
];

function readableGesture(type: GestureType): string {
  return gestures.find((gesture) => gesture.type === type)?.label ?? type;
}

function App() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actions, setActions] = useState(defaultActions);
  const [logs, setLogs] = useState<GestureLog[]>([]);
  const [lastGesture, setLastGesture] = useState<GestureType | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [selectedActionMessage, setSelectedActionMessage] = useState("");

  const handleGesture = useCallback(
    (event: DialEvent) => {
      if (!gestures.some((gesture) => gesture.type === event.type)) {
        return;
      }

      const action = actions[event.type];

      // Visual-only wheel prototype. No system actions are executed.
      if (
        event.type === "PRESS_SINGLE_TOGGLE" ||
        event.type === "PRESS_SINGLE_PLAY" ||
        event.type === "PRESS_SINGLE_PAUSE"
      ) {
        setWheelOpen(true);
        setSelectedActionMessage("");
      } else if (event.type === "PRESS_DOUBLE") {
        setWheelOpen(false);
        setSelectedActionMessage("");
      } else if (event.type === "ROTATE_CW") {
        setSelectedSlot((current) => (current + 1) % wheelActions.length);
      } else if (event.type === "ROTATE_CCW") {
        setSelectedSlot((current) => (current - 1 + wheelActions.length) % wheelActions.length);
      }

      setLastGesture(event.type);
      setLogs((previous) =>
        [
          {
            id: Date.now() + Math.random(),
            type: event.type,
            time: new Date().toLocaleTimeString(),
            action,
          },
          ...previous,
        ].slice(0, 100),
      );
    },
    [actions],
  );

  // Escape closes the preview while developing.
  useEffect(() => {
    if (!wheelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWheelOpen(false);
        setSelectedActionMessage("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [wheelOpen]);

  // Subscribe to events emitted by the Rust backend.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<DialEvent>("dial-event", (event) => {
      handleGesture(event.payload);
    })
      .then((stopListening) => {
        if (cancelled) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((cause: unknown) => {
        setError(
          `Could not subscribe to dial events: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleGesture]);

  async function startDetector() {
    setBusy(true);
    setError("");

    try {
      await invoke("start_detector");
      setRunning(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stopDetector() {
    setBusy(true);
    setError("");

    try {
      await invoke("stop_detector");
      setRunning(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function updateAction(type: GestureType, action: string) {
    setActions((previous) => ({ ...previous, [type]: action }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <h1>oribit</h1>
            <p>Smart Dial Control</p>
          </div>
        </div>

        <div className={`status ${running ? "status-online" : ""}`}>
          <span className="status-dot" />
          {running ? "Detector running" : "Detector stopped"}
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">CMF BUDS PRO 2</p>
        <h2>Your dial.<br />Your control.</h2>
        <p className="hero-copy">
          Capture dial gestures and prepare the actions you want them to trigger.
        </p>

        <div className="controls">
          {!running ? (
            <button
              className="primary-button"
              onClick={startDetector}
              disabled={busy}
            >
              {busy ? "Starting…" : "Start detector"}
            </button>
          ) : (
            <button
              className="primary-button stop-button"
              onClick={stopDetector}
              disabled={busy}
            >
              {busy ? "Stopping…" : "Stop detector"}
            </button>
          )}

          <button
            className="preview-button"
            onClick={() => {
              setWheelOpen(true);
              setSelectedActionMessage("");
            }}
          >
            Preview dial
          </button>
          <span className="control-hint">
            {running ? "Listening for gestures" : "Ready to connect"}
          </span>
        </div>

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
      </section>

      <section className="content-grid">
        <div className="panel last-event-panel">
          <div className="panel-heading">
            <h3>Latest gesture</h3>
            <span className="subtle-label">LIVE</span>
          </div>

          <div className="latest-event">
            <span className="gesture-symbol">
              {lastGesture === "ROTATE_CW"
                ? "↻"
                : lastGesture === "ROTATE_CCW"
                  ? "↺"
                  : lastGesture?.startsWith("PRESS_")
                    ? "●"
                    : "—"}
            </span>
            <div>
              <strong>
                {lastGesture ? readableGesture(lastGesture) : "Waiting for input"}
              </strong>
              <p>
                {lastGesture
                  ? `Mapped action: ${actions[lastGesture]}`
                  : "Start the detector and use your dial."}
              </p>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h3>Gesture activity</h3>
            <button className="text-button" onClick={() => setLogs([])}>
              Clear
            </button>
          </div>

          <div className="event-list" aria-live="polite">
            {logs.length === 0 ? (
              <p className="empty-state">Your detected gestures will appear here.</p>
            ) : (
              logs.map((log) => (
                <div className="event-row" key={log.id}>
                  <div className="event-info">
                    <strong>{readableGesture(log.type)}</strong>
                    <span>{log.time}</span>
                  </div>
                  <span className="event-action">{log.action}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel actions-panel">
        <div className="panel-heading">
          <div>
            <h3>Action mappings</h3>
            <p className="panel-description">
              Choose what each gesture should eventually do.
            </p>
          </div>
          <span className="subtle-label">PROTOTYPE</span>
        </div>

        <div className="mapping-list">
          {gestures.map((gesture) => (
            <label className="mapping-row" key={gesture.type}>
              <span className="mapping-info">
                <strong>{gesture.label}</strong>
                <small>{gesture.description}</small>
              </span>

              <select
                value={actions[gesture.type]}
                onChange={(event) =>
                  updateAction(gesture.type, event.target.value)
                }
              >
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p className="mapping-note">
          Action mappings are currently a UI prototype. Selecting an action
          changes the mapping displayed in the app; it does not yet execute
          system-level actions.
        </p>
      </section>

      <footer>
        <span>ORIBIT · EARLY ACCESS</span>
        <span>macOS · Native detector</span>
      </footer>

      {wheelOpen && (
        <div
          className="dial-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Oribit radial dial preview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWheelOpen(false);
          }}
        >
          <section className="dial-stage">
            <div className="dial-heading">
              <span className="dial-kicker">ORIBIT CONTROL</span>
              <button className="dial-close" onClick={() => setWheelOpen(false)} aria-label="Close dial">×</button>
            </div>

            <div className="radial-wheel">
              <div className="wheel-orbit wheel-orbit-outer" />
              <div className="wheel-orbit wheel-orbit-inner" />
              {wheelActions.map((item, index) => {
                const angle = (index / wheelActions.length) * Math.PI * 2 - Math.PI / 2;
                const radius = 142;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const selected = selectedSlot === index;
                return (
                  <button
                    key={item.label}
                    className={`wheel-action ${selected ? "wheel-action-selected" : ""}`}
                    style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
                    onClick={() => {
                      setSelectedSlot(index);
                      setSelectedActionMessage(`${item.label} selected — action is a visual placeholder.`);
                    }}
                    aria-pressed={selected}
                    title={item.detail}
                  >
                    <span className="wheel-action-icon">{item.icon}</span>
                    <span className="wheel-action-label">{item.label}</span>
                  </button>
                );
              })}
              <div className="wheel-center">
                <div className="wheel-center-mark">O</div>
                <strong>oribit</strong>
                <span>{wheelActions[selectedSlot].label}</span>
              </div>
            </div>

            <div className="dial-footer">
              <div className="dial-selected-copy">
                <span className="dial-kicker">SELECTED ACTION</span>
                <strong>{wheelActions[selectedSlot].label}</strong>
                <p>{selectedActionMessage || wheelActions[selectedSlot].detail}</p>
              </div>
              <div className="dial-hints">
                <span><kbd>↻</kbd> Rotate to navigate</span>
                <span><kbd>●</kbd> Single press to open</span>
                <span><kbd>●●</kbd> Double press to close</span>
                <span><kbd>esc</kbd> Click outside to dismiss</span>
              </div>
            </div>
            <p className="dial-prototype-note">DESIGN PREVIEW · Actions do not run yet</p>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
