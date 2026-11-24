# DevBox

A collection of small developer tools in one place (JSON format/compare, base converters, JWT, hashing, and more).

Everything runs **client-side in your browser**. There is no backend and no data leaves your machine.

## Stack

Vite + React 18 + TypeScript. Static build, deployable on any static host.

## Develop

```bash
npm install
npm run dev      # start dev server
npm run lint     # eslint
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
```

## Adding a tool

1. Create `src/tools/<tool-id>/logic.ts` (pure functions) with `logic.test.ts`, and `index.tsx` (default-exported UI component).
2. Register it in `src/tools/registry.ts` with `component: lazy(() => import("./<tool-id>"))`.
3. Use the shared pieces: `src/components/ui` (`TextPane`, `CopyButton`, `FileDropZone`, `ErrorDisplay`, `ShareButton`, `SendToMenu`),
   `useToolState(toolId, defaults)` for persisted + shareable state, and `usePipelineInput(toolId, cb)` if the tool sets `acceptsText`.

## Roadmap

See [`TODO.md`](./TODO.md).
