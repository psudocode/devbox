import { formatBytes } from "../../lib/files";

/** UTF-8 size of a string, formatted (e.g. "1.5 KiB"). */
export function byteSize(text: string): string {
  return formatBytes(new TextEncoder().encode(text).length);
}
