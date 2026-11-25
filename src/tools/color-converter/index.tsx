import { Badge, Button } from "@fluentui/react-components";
import { ArrowSwap16Regular } from "@fluentui/react-icons";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { formatColor, formatHex, parseColor, wcagContrast } from "./logic";

export const TOOL_ID = "color-converter";

interface State {
  input: string;
  fg: string;
  bg: string;
}

const DEFAULTS: State = {
  input: "#3b82f6",
  fg: "#ffffff",
  bg: "#1e293b",
};

function GradeBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Badge appearance="tint" color={pass ? "success" : "danger"} size="medium">
      {label}: {pass ? "Pass" : "Fail"}
    </Badge>
  );
}

export default function ColorConverter() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text.trim() }));

  const parsed = state.input.trim() === "" ? null : parseColor(state.input);
  const formatted = parsed?.ok ? formatColor(parsed.value.color) : null;
  const pickerHex = parsed?.ok ? formatHex(parsed.value.color, false) : "#000000";

  const fgParsed = parseColor(state.fg);
  const bgParsed = parseColor(state.bg);
  const contrast = fgParsed.ok && bgParsed.ok ? wcagContrast(fgParsed.value.color, bgParsed.value.color) : null;

  return (
    <div>
      <div className="toolbar">
        <div className="pane" style={{ flex: 1, minWidth: "15rem" }}>
          <div className="pane-header">
            <label htmlFor="color-input">Color (HEX, rgb, hsl, oklch)</label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="color-input"
              className="pane-text"
              type="text"
              value={state.input}
              placeholder="#3b82f6 or oklch(0.62 0.19 260)"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => update({ input: e.target.value })}
            />
            <input
              type="color"
              aria-label="Color picker"
              className="color-picker-input"
              value={pickerHex}
              onChange={(e) => update({ input: e.target.value })}
            />
          </div>
        </div>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ input: "" })}
          disabled={!state.input}
        >
          Clear
        </button>
      </div>

      {parsed && !parsed.ok && <ErrorDisplay error={parsed.error} title="Invalid color" />}
      {parsed?.ok && parsed.value.clamped && (
        <p className="warning">Out of sRGB gamut: clamped to the nearest displayable sRGB color.</p>
      )}

      {formatted && (
        <>
          <div
            className="color-swatch"
            style={{ background: formatted.rgb }}
            aria-label={`Color preview ${formatted.hex}`}
          />
          <dl className="results">
            {(
              [
                ["HEX", formatted.hex],
                ["RGB", formatted.rgb],
                ["HSL", formatted.hsl],
                ["OKLCH", formatted.oklch],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="result-row">
                <dt>{label}</dt>
                <dd>
                  <code>{value}</code>
                  <CopyButton text={value} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h2 className="section-title">WCAG contrast checker</h2>
      <div className="toolbar">
        <div className="pane" style={{ flex: 1, minWidth: "12rem" }}>
          <div className="pane-header">
            <label htmlFor="fg-input">Foreground</label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="fg-input"
              className="pane-text"
              type="text"
              value={state.fg}
              spellCheck={false}
              onChange={(e) => update({ fg: e.target.value })}
            />
            <input
              type="color"
              aria-label="Foreground color picker"
              className="color-picker-input"
              value={fgParsed.ok ? formatHex(fgParsed.value.color, false) : "#ffffff"}
              onChange={(e) => update({ fg: e.target.value })}
            />
          </div>
        </div>

        <Button
          size="small"
          appearance="outline"
          icon={<ArrowSwap16Regular />}
          onClick={() => update({ fg: state.bg, bg: state.fg })}
          title="Swap foreground and background"
        >
          Swap
        </Button>

        <div className="pane" style={{ flex: 1, minWidth: "12rem" }}>
          <div className="pane-header">
            <label htmlFor="bg-input">Background</label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="bg-input"
              className="pane-text"
              type="text"
              value={state.bg}
              spellCheck={false}
              onChange={(e) => update({ bg: e.target.value })}
            />
            <input
              type="color"
              aria-label="Background color picker"
              className="color-picker-input"
              value={bgParsed.ok ? formatHex(bgParsed.value.color, false) : "#000000"}
              onChange={(e) => update({ bg: e.target.value })}
            />
          </div>
        </div>
      </div>

      {!fgParsed.ok && <ErrorDisplay error={fgParsed.error} title="Invalid foreground color" />}
      {!bgParsed.ok && <ErrorDisplay error={bgParsed.error} title="Invalid background color" />}

      {contrast && fgParsed.ok && bgParsed.ok && (
        <div className="contrast-card">
          <div
            className="contrast-preview"
            style={{
              color: formatColor(fgParsed.value.color).rgb,
              background: formatColor(bgParsed.value.color).rgb,
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>Large text (18pt / 14pt bold)</div>
            <div>Normal body text — The quick brown fox jumps over the lazy dog.</div>
          </div>
          <div className="contrast-meta">
            <span className="contrast-ratio">
              Ratio: <strong>{contrast.ratio.toFixed(2)} : 1</strong>
            </span>
            <div className="regex-groups">
              <GradeBadge pass={contrast.aaNormal} label="AA Normal (4.5:1)" />
              <GradeBadge pass={contrast.aaLarge} label="AA Large (3:1)" />
              <GradeBadge pass={contrast.aaaNormal} label="AAA Normal (7:1)" />
              <GradeBadge pass={contrast.aaaLarge} label="AAA Large (4.5:1)" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
