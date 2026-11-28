# DevBox

**A collection of small developer tools in one place — 100% client-side in your browser.**

Everything runs locally in your browser. There is no backend, no telemetry, and no data leaves your machine.

[Roadmap](./TODO.md) · [Report a bug](https://github.com/psudocode/devbox/issues/new)

---

## Highlights

- **100% Client-Side:** All parsing, formatting, conversion, and cryptography run in the browser (using Web APIs like `crypto.subtle` wherever possible).
- **Fast Navigation:** Command palette (`Ctrl+K` / `Cmd+K`), search, favorites, and recently used tools.
- **Tool Pipelines:** Send output from one tool directly into another (`SendToMenu`), plus shareable state via URL hash (`#/tool-id`).
- **Offline Ready:** Installable PWA with service worker caching and persistent tool state in `localStorage`.
- **Dark & Light Theme:** Follows system preference with manual override.
- **Accessible:** Skip link, keyboard-operable palette and sidebar, labelled controls, `prefers-reduced-motion` support. See [Accessibility](#accessibility).

## Included Tools

### Data & Format
- JSON formatter / prettify, minify, validate, sort keys
- JSON compare / diff
- JSON ↔ YAML, CSV, XML, TOML
- JSON → TypeScript types / Go struct / Zod schema
- JSONPath / jq-style query tester
- YAML / XML / CSV validator and formatter
- SQL formatter, Markdown preview, HTML / CSS / JS beautify & minify, Text diff

### Encode / Decode / Convert
- Number base converter (hex, binary, decimal, octal, arbitrary base 2–36 via `BigInt`)
- Base64 (text & URL-safe), Base64 for files/images ↔ data URI
- Base32, Base58, Punycode
- URL encode/decode, HTML entities, Unicode escape (`\uXXXX`)
- Text ↔ hex / binary / ASCII + ASCII/Unicode table
- Bit / byte tools (endianness, bit flags, two's complement)

### Security & Crypto
- JWT decoder, JWT sign & verify (`HS256`, `RS256`, `ES256`)
- Hash generator (`MD5`, `SHA-1`, `SHA-256`, `SHA-384`, `SHA-512`, `HMAC`)
- UUID v4/v7, ULID, NanoID generators
- AES encrypt / decrypt
- RSA / ECDSA / Ed25519 key pair generator & PBKDF2

### Time, Web & Frontend
- Unix timestamp ↔ date (seconds/ms, timezone-aware)
- Regex tester (match highlight, groups, flags)
- Color converter (`HEX` / `RGB` / `HSL` / `OKLCH`) + WCAG contrast checker

> See [`TODO.md`](./TODO.md) for upcoming tools in Phase 2 and Phase 3.

## Tech Stack

TypeScript · React 18 · Vite · Fluent UI (`@fluentui/react-components`) · Vitest · GitHub Actions · Cloudflare Pages

## Getting Started (Development)

**Requirements:** Node.js 20+ and npm

```bash
git clone https://github.com/psudocode/devbox.git
cd devbox
npm install
npm run dev       # start the dev server
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run lint` | Run ESLint (`--max-warnings 0`) |
| `npm test` | Run unit tests (Vitest) |
| `npm run build` | Type-check (`tsc`) + production build into `dist/` |
| `npm run preview` | Serve the production build locally |

## Adding a Tool

1. Create `src/tools/<tool-id>/logic.ts` (pure functions) with `logic.test.ts`, and `index.tsx` (default-exported UI component).
2. Register it in `src/tools/registry.ts` with `component: lazy(() => import('./<tool-id>'))`.
3. Reuse shared UI from `src/components/ui` (`TextPane`, `CopyButton`, `FileDropZone`, `ErrorDisplay`, `ShareButton`, `SendToMenu`), `useToolState(toolId, defaults)` for persisted + shareable state, and `usePipelineInput(toolId, cb)` if the tool sets `acceptsText`.

## Accessibility

Audited with Lighthouse 13 and axe-core (WCAG 2.0/2.1 A + AA and best-practice rules) on the production build, in both light and dark themes.

| Page | Lighthouse accessibility | axe violations |
| --- | --- | --- |
| Home (`#/`) | 100 | 0 |
| JSON formatter | 100 | 0 |
| Base64 | 100 | 0 |
| Hash generator | 100 | 0 |

Audited 2026-11-28. Notable behavior: a "Skip to main content" link is the first tab stop; the `Ctrl+K` palette is a labelled modal combobox that keeps focus in its input and returns focus when closed; animations are disabled under `prefers-reduced-motion`; option switches no longer dim labels with opacity (that failed contrast in the light theme).

## Roadmap

See [`TODO.md`](./TODO.md) for the full checklist and conventions.
