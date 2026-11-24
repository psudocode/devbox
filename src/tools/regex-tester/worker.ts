import { runRegex, type RegexResult } from "./logic";

export interface WorkerRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  replacement: string | null;
}

export interface WorkerResponse {
  id: number;
  result: RegexResult;
}

// Runs in a Web Worker so a catastrophic pattern can be terminated without freezing the page.
self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, pattern, flags, text, replacement } = event.data;
  const response: WorkerResponse = { id, result: runRegex(pattern, flags, text, replacement) };
  self.postMessage(response);
});
