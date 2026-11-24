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
    <div className="error-display" role="alert">
      <strong>{title}</strong>
      <pre>{message}</pre>
    </div>
  );
}
