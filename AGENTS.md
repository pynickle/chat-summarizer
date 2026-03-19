# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-19  
**Commit:** 2d95b87  
**Branch:** master

## OVERVIEW
Koishi plugin for group chat capture, S3 upload, export, and AI summary rendering.
Stack: TypeScript + Koishi + esbuild + oxlint/oxfmt + semantic-release + AWS S3 SDK.

## STRUCTURE
```text
chat-summarizer/
├── src/                     # Runtime source of truth
│   ├── commands/            # cs.* command handlers and registration
│   ├── runtime/             # upload/summary/message runtime orchestration
│   ├── rendering/           # image/card rendering pipeline
│   ├── core/                # shared config/types/utils/errors
│   ├── ai/                  # prompts, parse, analysis service
│   ├── storage/             # S3 uploader/object/key/file helpers
│   ├── data/                # DB facade, parser, stats, file writer
│   └── export/              # export manager + contracts
├── lib/                     # build output (generated)
├── .github/workflows/       # release pipeline
├── esbuild.config.js
├── package.json
└── tsconfig.json
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Plugin lifecycle entry | `src/index.ts` | `apply()` wires database, commands, runtimes, hooks |
| Command routing | `src/commands/register.ts` | central registration for `cs.*` handlers |
| Runtime scheduling | `src/runtime/summary-runtime.ts`, `src/runtime/upload-runtime.ts` | timers and periodic jobs |
| Message ingest pipeline | `src/runtime/message-monitor.ts`, `src/runtime/chat-record-pipeline.ts` | on-message processing + persistence |
| AI analysis/summarization | `src/ai/ai-service.ts`, `src/ai/analysis-service.ts`, `src/ai/ai-prompts.ts` | LLM call + parse + prompt composition |
| S3 operations | `src/storage/s3-uploader.ts`, `src/storage/s3-object-ops.ts` | upload/download/list + key logic |
| Rendering | `src/rendering/card-renderer.ts`, `src/rendering/md-to-image.ts` | summary image/card generation |
| Shared contracts and helpers | `src/core/types.ts`, `src/core/config.ts`, `src/core/utils.ts` | cross-domain dependencies |

## CODE MAP
LSP symbol indexing timed out in this environment; map derived from AST/grep and runtime boundaries.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `apply` | function | `src/index.ts` | high | plugin bootstrap and event hook registration |
| `registerCommands` | function | `src/commands/register.ts` | high | binds all command modules to `ctx.command` |
| `createSummaryRuntime` | function | `src/runtime/summary-runtime.ts` | medium | schedules and executes daily summary jobs |
| `createUploadRuntime` | function | `src/runtime/upload-runtime.ts` | medium | upload and cleanup schedulers |
| `AIService` | class | `src/ai/ai-service.ts` | medium | model requests and response normalization |
| `S3Uploader` | class | `src/storage/s3-uploader.ts` | medium | low-level S3 upload/download handling |
| `DatabaseOperations` | class | `src/data/database.ts` | high | persistence facade for records and cleanup |
| `CardRenderer` | class | `src/rendering/card-renderer.ts` | medium | report-card render pipeline |

## CONVENTIONS
- Lint/format: `oxlint` + `oxfmt` only.
- Build contract: `esbuild` bundle + `tsc --emitDeclarationOnly` declarations.
- Runtime source is `src/`; never treat `lib/` as editable source.
- Operator/admin copy is Chinese-first; keep tone and terminology consistent.
- UTC+8 date helpers in `src/core/utils.ts` are canonical for scheduling and retention.

## ANTI-PATTERNS (THIS PROJECT)
- Do not edit `lib/*` manually.
- Do not bypass `src/data/database.ts` for direct ad-hoc DB writes.
- Do not hardcode duplicate date parsing/formatting logic outside `src/core/utils.ts`.
- Do not register new commands outside `src/commands/register.ts` flow.
- Do not bypass `SafeFileWriter` for concurrent chat log file writes.
- Do not introduce a parallel lint/format stack.

## UNIQUE STYLES
- Domain-sliced `src/` layout (`commands/runtime/rendering/core/...`) replaced earlier flat modules.
- Runtime uses factory functions (`create*Runtime`) to isolate scheduling concerns.
- Command layer is split into per-command files plus shared `common.ts` and `types.ts`.

## COMMANDS
```bash
pnpm run lint
pnpm run lint:fix
pnpm run fmt
pnpm run build
pnpm run semantic-release
```

## NOTES
- No test runner is configured; verification is lint + format + build/type emit.
- CI release is `.github/workflows/release.yml` + semantic-release.
- Hierarchical docs: `src/AGENTS.md`, `src/commands/AGENTS.md`, `src/runtime/AGENTS.md`, `src/rendering/AGENTS.md`, `src/core/AGENTS.md`.
