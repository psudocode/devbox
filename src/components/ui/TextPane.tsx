import { useId, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";

interface Props {
  label: string;
  value: string;
  /** Omit (or set readOnly) for an output pane. */
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  rows?: number;
  /** Show a copy button in the header. Default: true for read-only panes. */
  copyable?: boolean;
  /** Extra header controls (buttons, selects). */
  actions?: ReactNode;
}

/** Labeled monospace textarea used for both inputs and outputs. */
export function TextPane({ label, value, onChange, readOnly, placeholder, rows = 12, copyable, actions }: Props) {
  const id = useId();
  const isReadOnly = readOnly ?? !onChange;
  const showCopy = copyable ?? isReadOnly;

  return (
    <div className="pane">
      <div className="pane-header">
        <label htmlFor={id}>{label}</label>
        <span className="pane-actions">
          {actions}
          {showCopy && <CopyButton text={value} />}
        </span>
      </div>
      <textarea
        id={id}
        className="pane-text"
        value={value}
        readOnly={isReadOnly}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </div>
  );
}
