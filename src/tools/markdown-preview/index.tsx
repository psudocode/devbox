import { useMemo } from "react";
import { CopyButton, ErrorDisplay, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { useTheme } from "../../lib/useTheme";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { buildPreviewDocument, markdownStats, renderMarkdown } from "./logic";

export const TOOL_ID = "markdown-preview";

type View = "preview" | "html";

interface State {
  input: string;
  view: View;
  gfm: boolean;
  breaks: boolean;
  allowHtml: boolean;
  remoteImages: boolean;
}

const DEFAULTS: State = { input: "", view: "preview", gfm: true, breaks: false, allowHtml: false, remoteImages: false };

const SAMPLE = "# Title\n\nSome **bold** text, a [link](https://example.com) and `code`.\n\n- [x] Task lists\n- [ ] Tables\n\n| a | b |\n|---|---|\n| 1 | 2 |";

export default function MarkdownPreviewTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));
  const { resolved } = useTheme();

  const rendered = useMemo(
    () => renderMarkdown(state.input, { gfm: state.gfm, breaks: state.breaks, allowHtml: state.allowHtml }),
    [state.input, state.gfm, state.breaks, state.allowHtml],
  );
  const html = rendered.ok ? rendered.html : "";
  const error = rendered.ok ? null : rendered.error;

  const srcDoc = useMemo(
    () => buildPreviewDocument(html, { dark: resolved === "dark", remoteImages: state.remoteImages }),
    [html, resolved, state.remoteImages],
  );
  const stats = useMemo(() => markdownStats(state.input), [state.input]);

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Output" className="segmented">
          {(["preview", "html"] as const).map((view) => (
            <button
              key={view}
              type="button"
              className="btn-small"
              aria-pressed={state.view === view}
              onClick={() => update({ view })}
            >
              {view === "preview" ? "Preview" : "HTML"}
            </button>
          ))}
        </div>
        <ToolbarSwitch label="GitHub flavored" checked={state.gfm} onChange={(gfm) => update({ gfm })} />
        <ToolbarSwitch label="Line breaks" checked={state.breaks} onChange={(breaks) => update({ breaks })} />
        <ToolbarSwitch label="Allow raw HTML" checked={state.allowHtml} onChange={(allowHtml) => update({ allowHtml })} />
        <ToolbarSwitch
          label="Load remote images"
          checked={state.remoteImages}
          onChange={(remoteImages) => update({ remoteImages })}
        />
        <button type="button" className="btn-small" onClick={() => update({ input: SAMPLE })} disabled={state.input !== ""}>
          Sample
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      {state.input.trim() !== "" && (
        <p className="status" aria-live="polite">
          {stats.words} word{stats.words === 1 ? "" : "s"} · {stats.characters} characters · ~{stats.readingMinutes} min read
        </p>
      )}

      <div className="panes">
        <TextPane
          label="Markdown"
          value={state.input}
          rows={18}
          onChange={(input) => update({ input })}
          placeholder={"# Heading\n\nWrite **Markdown** here…"}
        />
        {state.view === "preview" ? (
          <div className="pane">
            <div className="pane-header">
              <span id="markdown-preview-label">Preview</span>
              <span className="pane-actions">
                <CopyButton text={html} label="Copy HTML" />
              </span>
            </div>
            <iframe
              title="Markdown preview"
              aria-labelledby="markdown-preview-label"
              // No scripts, no same-origin access, no forms: the document cannot run code or reach this app.
              // Popups are allowed (and escape the sandbox) only so links open in a new tab.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              srcDoc={srcDoc}
              style={{
                flex: 1,
                width: "100%",
                minHeight: "26rem",
                boxSizing: "border-box",
                border: "1px solid var(--colorNeutralStroke1)",
                borderRadius: "var(--borderRadiusMedium)",
              }}
            />
          </div>
        ) : (
          <TextPane label="HTML" value={html} rows={18} />
        )}
      </div>
      <ErrorDisplay error={error} title="Cannot render Markdown" />

      {stats.headings.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary>Outline ({stats.headings.length})</summary>
          <ul className="muted small" style={{ listStyle: "none", paddingLeft: 0 }}>
            {stats.headings.map((h, i) => (
              <li key={`${i}-${h.text}`} style={{ paddingLeft: `${(h.depth - 1) * 1}rem` }}>
                {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        The preview runs in a locked-down sandbox: no scripts, and no network requests unless you turn on remote images.
        Raw HTML is shown as text unless you allow it; unsafe link and image URLs are removed either way.
      </p>
    </div>
  );
}
