# SRC KNOWLEDGE BASE

**Scope:** Applies to `src/` and below. Inherits root `AGENTS.md` rules.

## OVERVIEW

Primary runtime tree. Entrypoint in `src/index.ts`; domain logic split by `commands/runtime/rendering/core/ai/storage/data/export`.

## STRUCTURE

```text
src/
├── index.ts               # plugin bootstrap + lifecycle hooks
├── commands.ts            # compatibility facade for command registration
├── commands/              # command handlers and command contracts
├── runtime/               # monitor/upload/summary runtimes and shared runtime services
├── rendering/             # summary card and markdown-image rendering
├── core/                  # shared config/types/date/error utilities
├── ai/                    # prompt builders, parser, AI service
├── storage/               # S3 uploader + object/key/file helpers
├── data/                  # schema extension, message parsing, stats, file writer
└── export/                # export manager + export types
```

## WHERE TO LOOK

| Change Type                          | Location                                                                                        | Why                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Hook wiring / startup order          | `src/index.ts`                                                                                  | single orchestration root for apply/ready/dispose |
| New or changed command               | `src/commands/register.ts`, `src/commands/*.ts`                                                 | command graph is split by capability              |
| Summary/upload timer behavior        | `src/runtime/summary-runtime.ts`, `src/runtime/upload-runtime.ts`                               | scheduler ownership lives here                    |
| Message capture and persistence flow | `src/runtime/message-monitor.ts`, `src/runtime/chat-record-pipeline.ts`, `src/data/database.ts` | ingest path crosses runtime + data                |
| Prompting, parse, analysis output    | `src/ai/ai-prompts.ts`, `src/ai/structured-parser.ts`, `src/ai/analysis-service.ts`             | AI contract boundary                              |
| S3 key/object/file behavior          | `src/storage/s3-key-utils.ts`, `src/storage/s3-object-ops.ts`, `src/storage/s3-uploader.ts`     | storage behavior is utility-driven                |
| Card visuals and rendering faults    | `src/rendering/card-renderer.ts`, `src/rendering/md-to-image.ts`                                | renderer entry points                             |

## LOCAL CHILD GUIDES

- `src/commands/AGENTS.md` for command registration and handler conventions.
- `src/runtime/AGENTS.md` for scheduler, pipeline, and side-effect boundaries.
- `src/rendering/AGENTS.md` for card/image rendering invariants.
- `src/core/AGENTS.md` for shared contracts, date/time, and config rules.

## SRC CONVENTIONS

- Keep cross-domain interfaces in `src/core/types.ts` or domain `types.ts` files; avoid circular imports through `index.ts`.
- Treat `src/commands.ts` as transition surface; canonical command composition is `src/commands/register.ts` + handler files.
- Keep UTC+8 assumptions centralized via `src/core/utils.ts` helpers.
- Reuse `runtime/services.ts` wrappers before adding direct SDK/API calls in feature modules.

## SRC ANTI-PATTERNS

- Do not add ad-hoc command registration outside `src/commands/register.ts`.
- Do not duplicate scheduler logic in handlers; timers belong in `src/runtime/*runtime.ts`.
- Do not copy prompt/date parsing helpers across domains; import from `src/ai/*` or `src/core/utils.ts`.
- Do not write chat log files without `src/data/file-writer.ts` queue discipline.
