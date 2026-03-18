# SRC KNOWLEDGE BASE

**Scope:** Applies to `src/` and below. Inherits root `AGENTS.md` rules.

## OVERVIEW

Runtime source for the Koishi plugin: message ingestion, persistence, upload, export, and AI summarization.

## STRUCTURE

```text
src/
├── index.ts           # Plugin entry and runtime orchestration (`apply`)
├── commands.ts        # `cs.*` command registration and handlers
├── database.ts        # Schema extension + DB operation facade
├── services.ts        # Logger/S3/processor wrappers
├── s3-uploader.ts     # S3 upload/key generation implementation
├── export.ts          # Chat log export manager
├── ai-service.ts      # AI request/response handling
├── card-renderer.ts   # Daily report card HTML/image rendering
├── md-to-image.ts     # Markdown-to-image rendering utility
├── message-processor.ts # Message element parsing/extraction
├── statistics.ts      # Interaction and activity analytics
├── file-writer.ts     # Safe queued file writes/updates
├── config.ts          # Koishi schema + constants + prompts
├── types.ts           # Shared contracts/interfaces
└── utils.ts           # Shared utility helpers
```

## WHERE TO LOOK

| Need                                 | File                                         | Why                                                  |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| Plugin lifecycle / hooks             | `src/index.ts`                               | Event listeners, scheduler setup, integration wiring |
| Admin command changes                | `src/commands.ts`                            | All `ctx.command(...)` definitions are centralized   |
| New DB fields or record lifecycle    | `src/database.ts`                            | Model extension and persistence methods              |
| Upload behavior/timeouts/key formats | `src/s3-uploader.ts`, `src/index.ts`         | Low-level upload and call sites                      |
| AI prompt/output behavior            | `src/ai-service.ts`, `src/config.ts`         | Prompt templates and parsing contracts               |
| Report rendering styles/layout       | `src/card-renderer.ts`, `src/md-to-image.ts` | HTML/CSS rendering paths                             |
| Shared helpers/types                 | `src/utils.ts`, `src/types.ts`               | Common functions and contracts                       |

## CONVENTIONS (SRC-SPECIFIC)

- Keep timezone-sensitive logic aligned to UTC+8 helper functions from `src/utils.ts`.
- Prefer reusing existing wrappers (`LoggerService`, `S3Service`, `MessageProcessorService`) over ad-hoc direct calls.
- Maintain current Chinese-first operator/admin text style for command replies and logs.
- For JSONL record shape changes, update contracts in `src/types.ts` first, then consumers.

## ANTI-PATTERNS (SRC-SPECIFIC)

- Do not duplicate date/time conversion logic; use `formatDateInUTC8`, `getDateStringInUTC8`, `getCurrentTimeInUTC8`.
- Do not scatter command registrations across files; keep command entrypoints in `src/commands.ts`.
- Do not write raw file IO for chat log writes when `SafeFileWriter` already handles concurrency safety.
- Do not bypass shared config/constants for hardcoded prompt text, URL replacement, or file encoding settings.

## COMPLEXITY HOTSPOTS

- `src/index.ts`, `src/commands.ts`, `src/card-renderer.ts`, `src/ai-service.ts`, `src/s3-uploader.ts`, `src/export.ts` are large files (>500 LOC).
- Prefer small, scoped edits in these files and validate adjacent behavior after changes.
