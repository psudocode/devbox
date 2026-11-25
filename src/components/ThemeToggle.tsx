import { Button } from "@fluentui/react-components";
import { Desktop16Regular, WeatherMoon16Regular, WeatherSunny16Regular } from "@fluentui/react-icons";
import { useTheme } from "../lib/useTheme";

const LABELS = { system: "System", light: "Light", dark: "Dark" } as const;
const ICONS = {
  system: <Desktop16Regular />,
  light: <WeatherSunny16Regular />,
  dark: <WeatherMoon16Regular />,
} as const;

export function ThemeToggle() {
  const { preference, cycle } = useTheme();
  return (
    <Button
      appearance="subtle"
      size="small"
      icon={ICONS[preference]}
      className="theme-toggle"
      onClick={cycle}
      title="Switch theme (system, light, dark)"
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
    >
      Theme: {LABELS[preference]}
    </Button>
  );
}
