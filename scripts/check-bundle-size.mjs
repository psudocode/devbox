import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(ROOT_DIR, "dist");
const ASSETS_DIR = path.resolve(DIST_DIR, "assets");

// Budgets in bytes (1 KiB = 1024 bytes)
export const DEFAULT_BUDGETS = {
  // Max size for any individual chunk (Vite default warning threshold is 500 kB)
  maxChunkSize: 500 * 1024, // 500 KiB (~512 kB)
  // Max initial JS loaded on first visit (index entry + preloads in index.html)
  maxInitialJsSize: 400 * 1024, // 400 KiB
  // Max initial CSS loaded on first visit
  maxInitialCssSize: 50 * 1024, // 50 KiB
};

export function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

export function analyzeBundle(distDir = DIST_DIR, budgets = DEFAULT_BUDGETS) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build directory does not exist: ${distDir}. Run "npm run build" first.`);
  }

  const assetsDir = path.resolve(distDir, "assets");
  const htmlPath = path.resolve(distDir, "index.html");

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`index.html not found in ${distDir}`);
  }

  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  // Extract initial script and style references from index.html
  const initialJsFiles = [];
  const initialCssFiles = [];

  // Match <script ... src="./assets/..." or href="./assets/..."
  const scriptRegex = /<script[^>]+src=["'](?:\.\/|\/)?assets\/([^"']+)["']/g;
  const preloadRegex = /<link[^>]+rel=["']modulepreload["'][^>]+href=["'](?:\.\/|\/)?assets\/([^"']+)["']/g;
  const cssRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["'](?:\.\/|\/)?assets\/([^"']+)["']/g;

  let match;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    initialJsFiles.push(match[1]);
  }
  while ((match = preloadRegex.exec(htmlContent)) !== null) {
    if (!initialJsFiles.includes(match[1])) {
      initialJsFiles.push(match[1]);
    }
  }
  while ((match = cssRegex.exec(htmlContent)) !== null) {
    initialCssFiles.push(match[1]);
  }

  // Read all asset files
  const allAssetFiles = fs.readdirSync(assetsDir);
  const chunks = [];

  for (const file of allAssetFiles) {
    const filePath = path.resolve(assetsDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const content = fs.readFileSync(filePath);
    const gzipSize = zlib.gzipSync(content).length;

    chunks.push({
      file,
      size: content.length,
      gzipSize,
      isJs: file.endsWith(".js"),
      isCss: file.endsWith(".css"),
      isInitial: initialJsFiles.includes(file) || initialCssFiles.includes(file),
    });
  }

  // Calculate initial sizes
  let initialJsSize = 0;
  let initialJsGzipSize = 0;
  let initialCssSize = 0;
  let initialCssGzipSize = 0;

  for (const chunk of chunks) {
    if (initialJsFiles.includes(chunk.file)) {
      initialJsSize += chunk.size;
      initialJsGzipSize += chunk.gzipSize;
    }
    if (initialCssFiles.includes(chunk.file)) {
      initialCssSize += chunk.size;
      initialCssGzipSize += chunk.gzipSize;
    }
  }

  // Check budget violations
  const violations = [];

  // 1. Max chunk size violation
  for (const chunk of chunks) {
    if (chunk.isJs && chunk.size > budgets.maxChunkSize) {
      violations.push({
        type: "chunk_size",
        file: chunk.file,
        size: chunk.size,
        budget: budgets.maxChunkSize,
        message: `Chunk "${chunk.file}" is ${formatBytes(chunk.size)}, exceeding maximum chunk budget of ${formatBytes(budgets.maxChunkSize)}`,
      });
    }
  }

  // 2. Initial JS size violation
  if (initialJsSize > budgets.maxInitialJsSize) {
    violations.push({
      type: "initial_js",
      size: initialJsSize,
      budget: budgets.maxInitialJsSize,
      message: `Initial JS size is ${formatBytes(initialJsSize)}, exceeding initial JS budget of ${formatBytes(budgets.maxInitialJsSize)}`,
    });
  }

  // 3. Initial CSS size violation
  if (initialCssSize > budgets.maxInitialCssSize) {
    violations.push({
      type: "initial_css",
      size: initialCssSize,
      budget: budgets.maxInitialCssSize,
      message: `Initial CSS size is ${formatBytes(initialCssSize)}, exceeding initial CSS budget of ${formatBytes(budgets.maxInitialCssSize)}`,
    });
  }

  return {
    chunks,
    initialJsFiles,
    initialCssFiles,
    initialJsSize,
    initialJsGzipSize,
    initialCssSize,
    initialCssGzipSize,
    budgets,
    violations,
    passed: violations.length === 0,
  };
}

export function printReport(result) {
  console.log("=== Bundle Size & Budget Report ===\n");

  console.log("Initial Load (Entry):");
  console.log(`  Initial JS:  ${formatBytes(result.initialJsSize)} (gzip: ${formatBytes(result.initialJsGzipSize)}) / budget: ${formatBytes(result.budgets.maxInitialJsSize)} [${result.initialJsSize <= result.budgets.maxInitialJsSize ? "OK" : "OVER"}]`);
  for (const file of result.initialJsFiles) {
    const chunk = result.chunks.find((c) => c.file === file);
    if (chunk) {
      console.log(`    - ${file}: ${formatBytes(chunk.size)} (gzip: ${formatBytes(chunk.gzipSize)})`);
    }
  }

  console.log(`  Initial CSS: ${formatBytes(result.initialCssSize)} (gzip: ${formatBytes(result.initialCssGzipSize)}) / budget: ${formatBytes(result.budgets.maxInitialCssSize)} [${result.initialCssSize <= result.budgets.maxInitialCssSize ? "OK" : "OVER"}]`);
  for (const file of result.initialCssFiles) {
    const chunk = result.chunks.find((c) => c.file === file);
    if (chunk) {
      console.log(`    - ${file}: ${formatBytes(chunk.size)} (gzip: ${formatBytes(chunk.gzipSize)})`);
    }
  }

  console.log("\nTop 10 Largest Chunks (Max Chunk Budget: " + formatBytes(result.budgets.maxChunkSize) + "):");
  const sortedChunks = [...result.chunks]
    .filter((c) => c.isJs)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  for (const chunk of sortedChunks) {
    const status = chunk.size <= result.budgets.maxChunkSize ? "OK" : "OVER";
    console.log(`  ${chunk.file.padEnd(35)} ${formatBytes(chunk.size).padStart(9)} (gzip: ${formatBytes(chunk.gzipSize).padStart(8)}) [${status}]`);
  }

  console.log("\n-----------------------------------");
  if (result.passed) {
    console.log("All bundle budgets passed! ✓");
  } else {
    console.error("Bundle budget violations detected! ✗");
    for (const v of result.violations) {
      console.error(`  - ${v.message}`);
    }
  }
  console.log("-----------------------------------\n");
}

// Execute CLI when run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = analyzeBundle();
    printReport(result);
    if (!result.passed) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Error checking bundle size:", err.message);
    process.exit(1);
  }
}
