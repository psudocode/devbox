# DevBox TODO

Roadmap for DevBox: small developer tools in one place, **100% client-side** (no server, no data leaves the browser).

Conventions:
- One checkbox = one deliverable (usually one tool). Work top to bottom unless noted.
- Each tool lives in `src/tools/<tool-id>/` with pure logic in `logic.ts` (unit-tested) and UI in `index.tsx`, and is registered in the tool registry.
- Prefer Web APIs (`crypto.subtle`, `TextEncoder`, `Intl`, `URL`, Canvas) over dependencies. Add a dependency only when it clearly pays off, and mention it in the PR.
- Mark an item `[x]` only when it is implemented, has tests for its logic, and `npm run lint && npm test && npm run build` pass.
- Owner can reorder, add or strike items at any time.

## Phase 0 - Platform foundation

- [x] Tool registry + hash router (`#/tool-id`, works on any static host) + app layout (sidebar, tool page, home grid)
- [x] Tool search and command palette (`Ctrl+K`)
- [x] Dark / light theme (follows system, user override)
- [x] Shared UI: input/output panes, copy button, file drop zone, error display
- [x] Persist last input per tool (`localStorage`) and shareable state via URL hash
- [x] Favorites and recently used tools
- [x] Unit test setup (Vitest) + `npm test` script
- [x] GitHub Actions CI: lint, test, build
- [x] PWA / offline support (service worker + manifest)
- [x] Chain / pipeline: send one tool's output into another tool
- [x] Static hosting + deploy workflow (GitHub Pages or Cloudflare Pages)

## Phase 1 - Most used tools (batch 1)

### Data & format
- [x] JSON formatter / prettify, minify, validate, sort keys
- [x] JSON compare / diff

### Encode / decode / convert
- [x] Number base converter: hex, binary, decimal, octal, arbitrary base 2-36 (BigInt)
- [x] Base64 encode/decode (text, URL-safe variant)
- [x] URL encode/decode

### Security
- [x] JWT decoder
- [x] Hash generator: MD5, SHA-1, SHA-256, SHA-384, SHA-512, HMAC
- [x] UUID v4/v7 generator, ULID, NanoID

### Time
- [x] Unix timestamp <-> date (seconds/ms, timezone aware)

### Web
- [x] Regex tester (match highlight, groups, flags)

### Frontend
- [x] Color converter (HEX/RGB/HSL/OKLCH) + WCAG contrast checker

## Phase 2 - Batch 2

### Data & format
- [x] JSON <-> YAML
- [x] JSON <-> CSV
- [x] JSON <-> XML
- [x] JSON <-> TOML
- [x] JSON -> TypeScript types / Go struct / Zod schema
- [x] JSONPath / jq-style query tester
- [x] YAML / XML / CSV validator and formatter
- [x] SQL formatter
- [x] Markdown preview
- [x] HTML / CSS / JS beautify and minify
- [x] Text diff (side by side)

### Encode / decode / convert
- [x] Base64 for files and images <-> data URI
- [x] HTML entities encode/decode
- [x] Unicode escape (`\uXXXX`) encode/decode
- [x] Text <-> hex / binary / ASCII + ASCII/Unicode table
- [x] Base32, Base58, Punycode
- [x] Bit / byte tools: endianness, bit flags, two's complement

### Security & crypto
- [x] JWT sign and verify (HS256, RS256, ES256)
- [x] AES encrypt / decrypt
- [x] RSA / ECDSA key pair generator, PBKDF2
- [x] Password generator and strength check
- [x] TOTP / OTP generator
- [x] PEM / X.509 certificate and CSR decoder, SSH key fingerprint
- [ ] bcrypt / argon2 hash (WASM, still client-side)

### Time
- [ ] Timezone converter
- [ ] Cron expression builder + explainer + next N runs
- [ ] Date difference calculator, ISO 8601 duration

### Web & network
- [ ] cURL <-> fetch / axios / Go converter
- [ ] URL parser, query string <-> JSON, query params builder
- [ ] HTTP status codes, MIME types and headers reference
- [ ] CIDR / subnet calculator, IP <-> integer, IPv6 expander
- [ ] User-agent parser

### Frontend & design
- [ ] QR code generate and scan
- [ ] CSS tools: gradient, box-shadow, px <-> rem
- [ ] CSS flexbox / grid playground
- [ ] Color palette generator

### Code & text
- [ ] Case converter (camel, snake, kebab, Pascal)
- [ ] Text utilities: word/char counter, slugify, dedupe lines, sort lines
- [ ] String escape / unescape
- [ ] Lorem ipsum + fake data generator (names, emails, Indonesian addresses, dummy NIK/NPWP format)
- [ ] `.env` <-> JSON
- [ ] `.gitignore` generator, Dockerfile / compose snippets

### Dev calculators
- [ ] Byte / data size converter (KB vs KiB), bandwidth and transfer time
- [ ] Percentage and ratio calculator
- [ ] Math expression evaluator, unit converter

## Phase 3 - Batch 3

### Code & backend
- [ ] ULID / KSUID decoder
- [ ] Go struct <-> JSON, TypeScript interface <-> JSON
