# RUNTIME KNOWLEDGE BASE

**Scope:** Applies to `src/runtime/` only. Inherits root + `src/AGENTS.md`.

## OVERVIEW

Runtime orchestration for message monitoring, scheduled upload/cleanup, and summary generation/push.

## STRUCTURE

```text
src/runtime/
├── services.ts             # logger/s3/message service wrappers
├── plugin-types.ts         # runtime contracts
├── message-monitor.ts      # on-message runtime entry
├── chat-record-pipeline.ts # message persistence + async upload pipeline
├── upload-runtime.ts       # upload and DB cleanup schedulers
├── summary-runtime.ts      # summary generation and per-group scheduling
├── summary-push.ts         # bot push behavior
└── summary-common.ts       # shared summary filtering/group config helpers
```

## WHERE TO LOOK

| Task                         | File                                                                    | Notes                          |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| Message ingest flow          | `src/runtime/message-monitor.ts`, `src/runtime/chat-record-pipeline.ts` | event -> parse -> persist path |
| Upload/cleanup timing        | `src/runtime/upload-runtime.ts`                                         | scheduler ownership            |
| Summary generation and retry | `src/runtime/summary-runtime.ts`                                        | largest side-effect hub        |
| Push destination behavior    | `src/runtime/summary-push.ts`                                           | group routing and bot fallback |
| Effective group config logic | `src/runtime/summary-common.ts`                                         | summary/push feature gates     |

## CONVENTIONS

- Keep timer creation/clear in runtime files; command handlers should trigger APIs, not manage schedulers.
- Use `runtime/services.ts` wrappers for logger/s3/message service access.
- Preserve guard checks (`ai.enabled`, uploader availability, group config) before expensive calls.
- Keep failure paths explicit with contextual logging (recordId/date/groupId).

## ANTI-PATTERNS

- Do not create new schedulers outside `*runtime.ts` files.
- Do not duplicate group effective-config logic; use `summary-common.ts` helpers.
- Do not bypass S3 SDK fallback flow in summary generation without equivalent error context.
- Do not push summaries directly from unrelated modules; keep push flow in `summary-push.ts`.

## HOTSPOTS

- `summary-runtime.ts`: orchestration + network + render + upload side effects.
- `upload-runtime.ts`: timer lifecycle and retention cleanup coupling.
