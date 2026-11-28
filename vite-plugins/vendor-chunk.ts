/**
 * Rollup `manualChunks` function: splits stable third-party code out of the app entry chunk so
 * it caches independently and no single chunk trips the size warning.
 * Returns undefined for everything else (Rollup's default chunking, incl. lazy tool chunks).
 */
export function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/node_modules\/@fluentui\/react-icons\//.test(id)) return "vendor-fluent-icons";
  if (/node_modules\/(@fluentui|@griffel|@floating-ui|tabster|keyborg)\//.test(id)) return "vendor-fluent";
  if (/node_modules\/terser\//.test(id)) return "vendor-terser";
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
  return undefined;
}
