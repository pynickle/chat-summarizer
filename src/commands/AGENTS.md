# COMMANDS KNOWLEDGE BASE

**Scope:** Applies to `src/commands/` only. Inherits root + `src/AGENTS.md`.

## OVERVIEW

Command layer for `cs.*`: registration, admin gate checks, argument parsing, and handler routing.

## STRUCTURE

```text
src/commands/
├── register.ts         # central command registration
├── types.ts            # command dependency contract
├── common.ts           # shared helpers (permission/arg/session)
├── status.ts           # cs.status
├── geturl.ts           # cs.geturl
├── export-command.ts   # cs.export
├── summary-command.ts  # cs.summary.*
├── analysis-command.ts # cs.analysis
└── mdtest-command.ts   # cs.mdtest
```

## WHERE TO LOOK

| Task                             | File                                                                                                    | Notes                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Add/modify command               | `src/commands/register.ts`                                                                              | register signature/options/examples first |
| Reuse command deps               | `src/commands/types.ts`                                                                                 | avoid ad-hoc dependency bags              |
| Shared command behavior          | `src/commands/common.ts`                                                                                | keep auth/session parsing consistent      |
| Export/Summary/Analysis behavior | `src/commands/export-command.ts`, `src/commands/summary-command.ts`, `src/commands/analysis-command.ts` | heavy command logic lives here            |

## CONVENTIONS

- Keep all `ctx.command()` definitions in `register.ts`.
- Command descriptions/examples stay Chinese-first, consistent with existing style.
- Handlers should receive `deps` + normalized args, not re-create services.
- Add new command files in this directory and wire them through `register.ts`.

## ANTI-PATTERNS

- Do not define commands directly in `src/index.ts`.
- Do not bypass shared permission/validation helpers in `common.ts`.
- Do not call runtime/storage internals directly from registration code; route through handlers.
- Do not duplicate option parsing logic across handlers when common helper can hold it.

## HOTSPOTS

- `register.ts`: high churn point for options/examples/action signatures.
- `summary-command.ts` and `export-command.ts`: higher regression risk due date range and admin constraints.
