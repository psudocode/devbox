import { Switch } from "@fluentui/react-components";

interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Fluent Switch with a dimmed label when off so active options stand out. */
export function ToolbarSwitch({ label, checked, onChange }: Props) {
  return (
    <Switch
      label={{
        children: label,
        style: { opacity: checked ? 1 : 0.55, transition: "opacity 0.15s ease" },
      }}
      checked={checked}
      onChange={(_, data) => onChange(data.checked)}
    />
  );
}
