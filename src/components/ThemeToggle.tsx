import { useTheme } from "../lib/useTheme";

const LABELS = { system: "System", light: "Light", dark: "Dark" } as const;

export function ThemeToggle() {
  const { preference, cycle } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title="Switch theme (system, light, dark)"
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
    >
      Theme: {LABELS[preference]}
    </button>
  );
}
