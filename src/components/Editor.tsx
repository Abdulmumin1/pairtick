import { useRef, type KeyboardEvent } from "react";
import type { RunLine } from "../lib/cometchat";
import { IconPlay } from "./icons";

export function Editor({
  code,
  onChange,
  onRun,
  running,
  output,
  remoteEdit,
  disabled,
}: {
  code: string;
  onChange: (code: string) => void;
  onRun: () => void;
  running: boolean;
  output: RunLine[];
  remoteEdit: string | null;
  disabled: boolean;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const lines = code.split("\n").length;

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onRun();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t } = el;
      const next = code.slice(0, s) + "  " + code.slice(t);
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };

  return (
    <div className="pane" style={{ flex: 1 }}>
      <div className="pane-head">
        <h3>Playground</h3>
        <span className="pill">JavaScript</span>
        {remoteEdit && <span className="faint small">{remoteEdit} is editing…</span>}
        <span className="grow" />
        <span className="faint small">⌘↵</span>
        <button className="btn primary" onClick={onRun} disabled={running}>
          <IconPlay /> {running ? "Running" : "Run"}
        </button>
      </div>
      <div className="editor">
        <div className="gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={ta}
          value={code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          readOnly={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          style={{ height: lines * 20 + 24 }}
          aria-label="Shared code editor"
        />
      </div>
      <div className="output">
        <div className="pane-head" style={{ height: 36 }}>
          <h3 className="small muted">Output</h3>
          <span className="faint small">shared with both sides</span>
        </div>
        <div className="output-body">
          {output.length === 0 && <div className="info">Run the code to see console output here.</div>}
          {output.map((l, i) => (
            <div key={i} className={l.kind}>
              {l.kind === "error" ? "✕ " : l.kind === "info" ? "· " : "› "}
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
