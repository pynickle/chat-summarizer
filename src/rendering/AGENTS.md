# RENDERING KNOWLEDGE BASE

**Scope:** Applies to `src/rendering/` only. Inherits root + `src/AGENTS.md`.

## OVERVIEW

Summary visual pipeline: transform structured report data into styled HTML and render PNG output.

## STRUCTURE

```text
src/rendering/
├── card-renderer.ts    # main render orchestrator and queue
├── md-to-image.ts      # markdown render path
├── card-styles.ts      # aggregated style exports
├── card-style-base.ts  # base style blocks
├── card-style-extra.ts # extra style blocks
├── card-header.ts      # header section rendering
├── card-text-utils.ts  # sanitize/escape/text helpers
└── card-emoji.ts       # emoji -> image conversion
```

## WHERE TO LOOK

| Task                   | File                                                            | Notes                              |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------- |
| Layout composition     | `src/rendering/card-renderer.ts`                                | `generateHTML()` section order     |
| Style changes          | `src/rendering/card-styles.ts`, `src/rendering/card-style-*.ts` | keep styles centralized            |
| Text safety/cleanup    | `src/rendering/card-text-utils.ts`                              | escape/URL cleanup rules           |
| Emoji rendering issues | `src/rendering/card-emoji.ts`                                   | conversion and fallback behavior   |
| Markdown image path    | `src/rendering/md-to-image.ts`                                  | separate from report-card renderer |

## CONVENTIONS

- Keep renderer queue discipline in `CardRenderer` (`waitForRenderSlot`/`releaseRenderSlot`).
- Maintain deterministic section ordering in `generateHTML()`.
- Escape user content before interpolation; rely on existing text utils.
- Keep screenshot viewport/clip logic explicit and stable for regression control.

## ANTI-PATTERNS

- Do not inline large CSS strings in unrelated modules.
- Do not bypass escape/sanitize helpers when rendering dynamic text.
- Do not remove render queue guarding; concurrent render collisions are real.
- Do not scatter emoji conversion across modules; centralize in `card-emoji.ts`.

## HOTSPOTS

- `card-renderer.ts`: queue + puppeteer lifecycle + section generation.
- `md-to-image.ts`: external assets and rendering reliability.
