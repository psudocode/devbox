import { runRegex, type RegexResult } from "./logic";
import type { WorkerRequest, WorkerResponse } from "./worker";

export const TIMEOUT_MS = 1500;

export type RegexJob = Omit<WorkerRequest, "id">;

export const TIMEOUT_MESSAGE = `Stopped after ${TIMEOUT_MS / 1000}s: this pattern is probably backtracking catastrophically (for example nested quantifiers like (a+)+). Simplify it.`;

export interface RegexExecutor {
  /** Resolves with the result, or null if a newer job replaced this one. */
  run(job: RegexJob): Promise<RegexResult | null>;
  dispose(): void;
}

/**
 * Runs regexes in a Web Worker with a timeout: a catastrophic pattern would otherwise freeze the tab,
 * because JavaScript cannot interrupt a running regex. When Workers are unavailable (tests, very old
 * browsers) it falls back to running inline, without a timeout.
 */
export function createRegexExecutor(timeoutMs = TIMEOUT_MS): RegexExecutor {
  let worker: Worker | null = null;
  let nextId = 0;
  let pending: { id: number; resolve: (r: RegexResult | null) => void; timer: number } | null = null;

  const settle = (result: RegexResult | null) => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.resolve(result);
    pending = null;
  };

  const startWorker = () => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (pending && event.data.id === pending.id) settle(event.data.result);
    });
    w.addEventListener("error", () => {
      settle({ ok: false, error: "The regex worker failed to run." });
      w.terminate();
      if (worker === w) worker = null;
    });
    return w;
  };

  return {
    run(job) {
      settle(null); // supersede the previous job
      if (typeof Worker === "undefined") {
        return Promise.resolve(runRegex(job.pattern, job.flags, job.text, job.replacement));
      }
      worker ??= startWorker();
      const id = ++nextId;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          // Kill the stuck worker; a fresh one is created for the next job.
          worker?.terminate();
          worker = null;
          settle({ ok: false, error: TIMEOUT_MESSAGE });
        }, timeoutMs);
        pending = { id, resolve, timer };
        worker!.postMessage({ id, ...job } satisfies WorkerRequest);
      });
    },
    dispose() {
      settle(null);
      worker?.terminate();
      worker = null;
    },
  };
}
