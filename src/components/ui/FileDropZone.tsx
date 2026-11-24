import { useRef, useState, type DragEvent } from "react";
import { formatBytes, matchesAccept } from "../../lib/files";
import { ErrorDisplay } from "./ErrorDisplay";

interface Props {
  onFile: (file: File) => void;
  /** Same format as the HTML `accept` attribute, e.g. ".json,image/*". */
  accept?: string;
  maxBytes?: number;
  label?: string;
}

/** Click-to-browse or drag-and-drop a single file. Files never leave the browser. */
export function FileDropZone({ onFile, accept, maxBytes, label = "Drop a file here or click to browse" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (file: File | undefined) => {
    if (!file) return;
    if (!matchesAccept(file, accept)) {
      setError(`"${file.name}" is not an accepted file type${accept ? ` (${accept})` : ""}.`);
      return;
    }
    if (maxBytes !== undefined && file.size > maxBytes) {
      setError(`"${file.name}" is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`);
      return;
    }
    setError(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handle(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div
        className={dragging ? "dropzone dragging" : "dropzone"}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </div>
      <ErrorDisplay error={error} title="Cannot use this file" />
    </div>
  );
}
