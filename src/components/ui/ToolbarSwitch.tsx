import { Switch } from "@fluentui/react-components";

interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Fluent Switch; the label is bolder when on. (Dimming via opacity fails WCAG contrast in light theme.) */
export function ToolbarSwitch({ label, checked, onChange }: Props) {
  return (
    <Switch
      label={{
        children: label,
        style: { fontWeight: checked ? 600 : 400 },
      }}
      checked={checked}
      onChange={(_, data) => onChange(data.checked)}
    />
  );
}
