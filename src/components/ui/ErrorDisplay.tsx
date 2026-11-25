import { MessageBar, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";

interface Props {
  /** Error message or Error object. Renders nothing when empty. */
  error: string | Error | null | undefined;
  title?: string;
}

export function ErrorDisplay({ error, title = "Error" }: Props) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  if (!message) return null;
  return (
    <MessageBar intent="error" className="error-display" role="alert">
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        <pre>{message}</pre>
      </MessageBarBody>
    </MessageBar>
  );
}
