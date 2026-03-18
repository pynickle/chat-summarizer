# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-18  
**Commit:** c235cd1  
**Branch:** master

## OVERVIEW
Koishi plugin that captures group chat messages, persists JSONL/database records, uploads media/chat logs to S3-compatible storage, and generates AI summary images.
Stack: TypeScript + Koishi + esbuild + oxlint/oxfmt + AWS SDK (S3).

## STRUCTURE
```text
chat-summarizer/
├── src/                 # Source of all runtime logic (entry, commands, services)
├── lib/                 # Build artifacts consumed by Koishi runtime
├── .github/workflows/   # Release pipeline (build + semantic-release)
├── esbuild.config.js    # Bundling to lib/index.cjs
├── package.json         # Scripts, dependencies, plugin metadata
└── tsconfig.json        # TypeScript compilation contract
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Plugin bootstrapping / lifecycle | `src/index.ts` | `apply()` is the runtime orchestration center |
| Command behavior (`cs.*`) | `src/commands.ts` | Admin checks, export/summary/analysis command handlers |
| S3 upload implementation | `src/s3-uploader.ts`, `src/services.ts` | Key generation + uploader init/wrappers |
| DB schema and operations | `src/database.ts` | Koishi model extension + CRUD helpers |
| Export pipeline | `src/export.ts` | Range parsing, formatting, optional summary integration |
| AI summary logic | `src/ai-service.ts`, `src/card-renderer.ts`, `src/md-to-image.ts` | Prompting + render-to-image paths |
| Shared contracts/utilities | `src/types.ts`, `src/utils.ts`, `src/config.ts` | Reused across most modules |

## CODE MAP
LSP symbol indexing timed out in this environment; map is built from AST/grep evidence.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `apply` | function | `src/index.ts` | n/a | Main plugin initialization and scheduler wiring |
| `Commands` | class | `src/commands.ts` | n/a | Registers and implements all `cs.*` commands |
| `DatabaseOperations` | class | `src/database.ts` | n/a | Encapsulates DB reads/writes and cleanup |
| `S3Uploader` | class | `src/s3-uploader.ts` | n/a | Low-level upload client and key strategy |
| `AIService` | class | `src/ai-service.ts` | n/a | LLM request assembly and response normalization |
| `CardRenderer` | class | `src/card-renderer.ts` | n/a | Daily report image rendering pipeline |
| `StatisticsService` | class | `src/statistics.ts` | n/a | Message parsing and interaction metrics |

## CONVENTIONS
- Lint/format toolchain is `oxlint` + `oxfmt` (not ESLint/Prettier).
- Build is `esbuild` + `tsc --emitDeclarationOnly`; output target is `lib/index.cjs`.
- Code and logs are mixed Chinese/English; keep user-facing/admin messages consistent with existing Chinese tone.
- Source of truth is `src/`; `lib/` is generated output.

## ANTI-PATTERNS (THIS PROJECT)
- Do not edit `lib/*` manually; changes must originate in `src/*` and be built.
- Do not bypass `DatabaseOperations` for ad-hoc DB mutations in new code.
- Do not introduce a second lint/format stack unless migrating entire repo.
- Do not add command handlers outside `src/commands.ts` without a clear module split plan.

## UNIQUE STYLES
- Monolithic orchestration in `src/index.ts` and large command surface in `src/commands.ts` are current architecture realities.
- Utility layering pattern is explicit: contracts (`types.ts`), cross-cutting helpers (`utils.ts`), constants/schema (`config.ts`).
- Scheduling and retention logic are UTC+8 aware; date helpers in `src/utils.ts` are canonical.

## COMMANDS
```bash
pnpm run lint
pnpm run lint:fix
pnpm run fmt
pnpm run build
pnpm run semantic-release
```

## NOTES
- No test runner/tests are currently configured; validation is lint + type declarations + build.
- CI release pipeline is in `.github/workflows/release.yml` and centers on semantic-release.
- For source-level implementation guidance, also read `src/AGENTS.md`.
