# @alenfitz/spec-copilot

**Spec-Driven Development Framework** — One package, six AI coding tools. Turn AI coding from "black-box YOLO" into "white-box step-by-step."

[中文文档](https://github.com/Alenfitz/spec_copilot/blob/main/README.zh-CN.md)

> **v4.0 (Breaking Change)** — A deliberate subtraction. Simpler spec template (-63% lines), fewer required fields (9 → 4), new `/spec:lite` path for light requirements, three stack adapters (Vue+Spring Boot, React+Express, Next.js), and the framework now has its own tests (37 cases, CI on Ubuntu/macOS/Windows × Node 18/20/22). See [CHANGELOG](framework/CHANGELOG.md#400---2026-05-24--breaking-change) for migration.

---

## Supported Tools

| Tool | Prompt File | Commands |
|------|-----------|----------|
| **opencode** | `AGENTS.md` | `.opencode/commands/` (native) |
| **Claude Code** | `CLAUDE.md` | `.claude/commands/` (native) |
| **Cursor** | `.cursor/rules/spec-copilot.mdc` + `.cursorrules` (legacy) | Prompt routing |
| **Windsurf** | `.windsurf/rules/spec-copilot.md` + `.windsurfrules` (legacy) | Prompt routing |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Prompt routing |
| **Cline** | `.clinerules/spec-copilot.md` | Prompt routing |

## Built-in Stack Adapters

| Stack | File |
|-------|------|
| Spring Boot + Vue 3 | `framework/stack-adapters/spring-boot-vue3.md` |
| React + Express | `framework/stack-adapters/react-express.md` |
| Next.js 13+ (App Router) | `framework/stack-adapters/nextjs.md` |

For other stacks, copy `_template.md` and fill in.

## Quick Start

```bash
# Install — specify your tool
npx @alenfitz/spec-copilot install --tool cursor
npx @alenfitz/spec-copilot install --tool claude-code
npx @alenfitz/spec-copilot install --tool windsurf
# ... any of: opencode, claude-code, cursor, windsurf, copilot, cline

# Verify
npx @alenfitz/spec-copilot doctor
```

The framework auto-detects your tool on subsequent commands (`update`, `doctor`, etc.).

## How It Works

1. **Spec First (No Spec, No Code)** — AI evaluates complexity, asks questions, generates spec in segments. No confirmed spec, no code written.
2. **Task Rhythm** — AI completes one atomic task, shows proof, commits immediately, then **waits for you to say "continue."**
3. **Knowledge Flywheel** — Pitfalls are logged and archived into a tag-indexed knowledge base. Next requirement reads past experience.

## Commands

| Command | When | Output |
|---------|------|--------|
| `/spec:init` | First time setup | Fills `rules/project-context.md` |
| `/spec:bootstrap` | New empty project | Tech stack selection + scaffolding |
| **`/spec:lite <req>`** | **Light requirement** (bug fix, UI tweak, small feature) | 5-section mini-spec → direct coding |
| `/spec:propose <req>` | Heavy requirement | `spec.md` + `tasks.md` |
| `/spec:flow <req>` | Full auto pipeline | propose → apply → smoke → review → archive (explicitly skips task-by-task pauses) |
| `/spec:apply <name>` | After spec confirmed | Code committed task by task |
| `/spec:smoke <name>` | After /spec:apply | Build + E2E + API smoke |
| `/spec:review <name>` | After /spec:smoke | Spec compliance + code quality |
| `/spec:fix <name>` | After review issues | Fix commits + doc sync |
| `/spec:archive <name>` | After review passes | Knowledge captured, docs updated |
| `/spec:docs [type]` | Anytime | README + API + Architecture + Deploy docs |
| `/spec:hotfix <desc>` | Production incident | Minimal fix on hotfix branch |
| `/spec:test <name>` | Need automated tests | Test code + run results |

## CLI Commands

```bash
npx @alenfitz/spec-copilot install --tool <name>    # Install framework
npx @alenfitz/spec-copilot update [--force]          # Upgrade framework
npx @alenfitz/spec-copilot sync [--tool <name>]      # Re-sync adapter files
npx @alenfitz/spec-copilot gate <name> <phase>       # Phase gate check
npx @alenfitz/spec-copilot lint <name>               # Spec completeness check
npx @alenfitz/spec-copilot agents list               # List built-in agent profiles
npx @alenfitz/spec-copilot scorecard <msg-file>      # Validate task commit self-scorecard
npx @alenfitz/spec-copilot guard status              # View guardrail status
npx @alenfitz/spec-copilot ci setup                  # Generate CI/CD config
npx @alenfitz/spec-copilot doctor                    # Health check
npx @alenfitz/spec-copilot uninstall --confirm       # Remove framework
```

## What Gets Installed

```
your-project/
├── <tool-specific prompt file>        ← AI reads this
├── <tool-specific commands/>          ← Native commands (if supported)
└── spec_copilot/
    ├── commands/                      ← 13 command definitions
    ├── rules/
    │   ├── coding-style.md            ← Universal coding standards
    │   ├── security.md                ← Security red lines
    │   ├── project-context.md         ← Your project's tech context
    │   └── domain-rules.md            ← Business rules (you fill this)
    ├── stack-adapters/
    │   ├── _template.md               ← Template for new tech stacks
    │   └── spring-boot-vue3.md        ← Built-in adapter (example)
    ├── knowledge/index.md             ← Tag-indexed knowledge base
    ├── changes/templates/             ← spec.md / tasks.md / log.md
    ├── archives/                      ← Completed requirements
    ├── agents/                        ← Built-in agent profiles
    └── scripts/                       ← Lint, gate, hook scripts
```

## Gate System (Automated Quality Checks)

The CLI gate system blocks phase transitions until objective criteria are met:

```bash
npx @alenfitz/spec-copilot gate <name> smoke
```

| Gate | Checks |
|------|--------|
| `apply` | Spec completeness + §9 cleared |
| `smoke` | Build verification + skeleton detection + **E2E browser smoke** |
| `review` | Smoke sentinel + feature coverage + API contract matching + contract consistency + hardcoded identity |
| `archive` | Review sentinel + spec audit conclusion |

### E2E Browser Smoke

Playwright-based end-to-end verification — catches "compiles but doesn't work" issues:

- **Auto-detects** tech stack (Spring Boot + Vue3, Vite, Next.js, etc.) and starts dev servers
- **Spec-driven** route extraction from spec.md + project router files
- **Per-page checks**: white screen, uncaught JS errors, API 4xx/5xx, non-JSON responses, empty rendering, framework error overlays
- **Active interaction**: search input, pagination clicks, form submission with auto-fill
- **Zero config** for common stacks, optional flags: `--headed`, `--base-url`, `--no-e2e`

Uses system-installed Chrome — no extra installation needed. Just have Chrome on your machine.

### Precise API Matching

`review` uses your spec's API coverage matrix (§6.1) for precise function-level matching:

- Frontend callers (e.g. `src/api/user.ts#getUser`) and backend entries (e.g. `UserController#getUser`) are matched exactly
- Fallback to fuzzy grep only when the matrix is missing
- Reduces false positives compared to keyword-only matching

### Contract Consistency

`review` checks frontend request fields against backend required fields:

- Flags field-name mismatches between caller and handler
- Detects hardcoded current-user / operator identity in frontend code
- Catches "UI looks complete but the API cannot actually be called" before it becomes a production issue

### Guard System — Code-Enforced Guardrails

AI tools ignore prompt-based rules. Guard uses **hash verification at gate time** — AI can modify files, but modified files fail the gate:

```bash
npx @alenfitz/spec-copilot guard install    # Initialize protection (record hashes)
npx @alenfitz/spec-copilot guard status     # View protection & integrity status
npx @alenfitz/spec-copilot guard lock       # Lock files (record hash, auto by phase)
npx @alenfitz/spec-copilot guard unlock     # Human unlock (clear hash record)
```

**Gate blocks when protected files are tampered:**
- ❌ Modifying `spec.md` after approval (auto-locked when gate passes)
- ❌ Modifying `domain-rules.md` / `project-context.md` (permanently protected)
- ❌ Committing skeleton components (optional git hook)

**Zero dependencies**: no git, no chmod, no special permissions. Works on all platforms.
Works with **all AI tools**: Claude Code, Cursor, Windsurf, Copilot, Cline, opencode.

## Complexity Tiers (v4.0)

| Tier | Criteria | Command |
|------|----------|---------|
| 🟢 Light | No API/schema/core flow/new dependency changes | `/spec:lite` — 5-section mini-spec in chat, direct coding |
| 🔴 Heavy | New API / schema change / core flow / new dep / data migration / concurrency | `/spec:propose` — full spec + tasks + gates |

`/spec:flow` is not a third complexity tier. It means the user explicitly authorizes the AI to run the full heavy-requirement pipeline without pausing after each task.

## Upgrade Safety

- **Overwritten**: coding-style.md, security.md, templates, scripts, commands, built-in adapters
- **Skipped by default**: prompt file (use `--force`)
- **Never touched**: project-context.md, domain-rules.md, knowledge/, changes/, archives/, custom adapters

## Related Packages

- [`@alenfitz/opencode-copilot`](https://www.npmjs.com/package/@alenfitz/opencode-copilot) — opencode-only version
- [`@alenfitz/spec-driven-dev`](https://www.npmjs.com/package/@alenfitz/spec-driven-dev) — Claude Code-only version (legacy)

## License

MIT
