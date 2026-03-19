# CORE KNOWLEDGE BASE

**Scope:** Applies to `src/core/` only. Inherits root + `src/AGENTS.md`.

## OVERVIEW

Shared cross-domain contracts and helpers: config schema, common types, timezone/date helpers, and error utilities.

## STRUCTURE

```text
src/core/
├── config.ts      # plugin schema/constants/defaults/prompts glue
├── types.ts       # shared domain contracts
├── utils.ts       # UTC+8 date/time, batch, JSON and misc helpers
└── error-utils.ts # HTTP and log-safe error context helpers
```

## WHERE TO LOOK

| Task                          | File                      | Notes                            |
| ----------------------------- | ------------------------- | -------------------------------- |
| Add shared type               | `src/core/types.ts`       | source of cross-domain contracts |
| Change config schema/defaults | `src/core/config.ts`      | single schema authority          |
| Date/time behavior            | `src/core/utils.ts`       | canonical UTC+8 helpers          |
| HTTP/error logging detail     | `src/core/error-utils.ts` | safe extraction and redaction    |

## CONVENTIONS

- Add reusable contract types here before duplicating interfaces in feature domains.
- Preserve timezone behavior via `Asia/Shanghai` helpers in `utils.ts`.
- Keep config constants and schema aligned; update both in one change.
- Keep error context helpers log-safe (sanitize URL/body where needed).

## ANTI-PATTERNS

- Do not duplicate date parsing/formatting helpers outside `core/utils.ts`.
- Do not redefine shared types in feature modules when `core/types.ts` can host them.
- Do not hardcode constants that already exist in `core/config.ts`.
- Do not log raw sensitive URLs without sanitization from error helpers.

## HOTSPOTS

- `utils.ts`: high export density and broad transitive usage.
- `types.ts`: contract changes can cascade into commands/runtime/ai/storage/data.
