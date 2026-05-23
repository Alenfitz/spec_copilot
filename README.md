# @alenfitz/spec-copilot

**Spec-Driven Development Framework** — One package, six AI coding tools. Turn AI coding from "black-box YOLO" into "white-box step-by-step."

[中文文档](https://github.com/Alenfitz/spec_copilit/blob/main/README.zh-CN.md)

---

## Supported Tools

| Tool | Prompt File | Commands |
|------|-----------|----------|
| **opencode** | `AGENTS.md` | `.opencode/commands/` (native) |
| **Claude Code** | `CLAUDE.md` | `.claude/commands/` (native) |
| **Cursor** | `.cursor/rules/spec-copilot.mdc` | Prompt routing |
| **Windsurf** | `.windsurf/rules/spec-copilot.md` | Prompt routing |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Prompt routing |
| **Cline** | `.clinerules/spec-copilot.md` | Prompt routing |

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
| `/spec:propose <req>` | New requirement | `spec.md` (+ `tasks.md` if complex) |
| `/spec:flow <req>` | Auto mode (simple/medium) | Full pipeline: propose → archive |
| `/spec:apply <name>` | After spec confirmed | Code committed task by task |
| `/spec:smoke <name>` | After /spec:apply | Build + API smoke test |
| `/spec:review <name>` | After /spec:smoke | Spec compliance + code quality report |
| `/spec:fix <name>` | After review issues | Fix commits + doc sync |
| `/spec:archive <name>` | After review passes | Knowledge captured, docs updated, merge prompt |
| `/spec:docs [type]` | Anytime | README + API + Architecture + Deploy docs |
| `/spec:hotfix <desc>` | Production incident | Minimal fix on hotfix branch |
| `/spec:test <name>` | Need automated tests | Test code + run results |

## CLI Commands

```bash
npx @alenfitz/spec-copilot install --tool <name>    # Install framework
npx @alenfitz/spec-copilot update [--force]          # Upgrade framework
npx @alenfitz/spec-copilot gate <name> <phase>       # Phase gate check
npx @alenfitz/spec-copilot lint <name>               # Spec completeness check
npx @alenfitz/spec-copilot doctor                    # Health check
npx @alenfitz/spec-copilot uninstall --confirm       # Remove framework
```

## What Gets Installed

```
your-project/
├── <tool-specific prompt file>        ← AI reads this
├── <tool-specific commands/>          ← Native commands (if supported)
├── README.md                          ← Auto-generated project docs
├── docs/                              ← API, architecture, deploy docs
│
└── spec_copilot/
    ├── commands/                      ← 12 command definitions
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
    └── scripts/                       ← Lint, gate, hook scripts
```

## Gate System (Automated Quality Checks)

The CLI gate system blocks phase transitions until objective criteria are met:

```bash
npx @alenfitz/spec-copilot gate <name> smoke
```

| Gate | Checks |
|------|--------|
| `apply` | Spec completeness + task interleaving + frontend task granularity |
| `smoke` | **Build verification** + **skeleton detection** + TS any abuse + **E2E browser smoke** |
| `review` | Smoke sentinel + feature coverage + dead code + stub handlers + hype language |
| `archive` | Review sentinel + spec audit conclusion |

### E2E Browser Smoke (v2.3.0)

Playwright-based end-to-end verification — catches "compiles but doesn't work" issues:

- **Auto-detects** tech stack (Spring Boot + Vue3, Vite, etc.) and starts dev servers
- **Spec-driven** route extraction from spec.md + project router files
- **Checks per page**: white screen, uncaught JS errors, API failures, framework error overlays
- **Zero config** for common stacks, optional flags: `--headed`, `--base-url`, `--no-e2e`

Uses system-installed Chrome — no extra installation needed. Just have Chrome on your machine.

### Guard System (v2.6.0) — Code-Enforced Guardrails

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
- ❌ Committing skeleton `.vue` components (optional git hook)

**Zero dependencies**: no git, no chmod, no special permissions. Works on all platforms.
Works with **all AI tools**: Claude Code, Cursor, Windsurf, Copilot, Cline, opencode. Human unlock: `spec-copilot guard unlock <file>`.

## Complexity Tiers

| Tier | Criteria | What's Required |
|------|----------|----------------|
| 🟢 Simple | No API/schema/core flow/new dependency changes | Direct conversation, no spec |
| 🟡 Medium | New APIs, non-core schema, new dependency | Spec (2-segment confirmation) |
| 🔴 Complex | New subsystem, core flow, core schema, concurrency | Spec + tasks + knowledge |

## Upgrade Safety

- **Overwritten**: coding-style.md, security.md, templates, scripts, commands, built-in adapters
- **Skipped by default**: prompt file (use `--force`)
- **Never touched**: project-context.md, domain-rules.md, knowledge/, changes/, archives/, custom adapters

## Related Packages

- [`@alenfitz/opencode-copilot`](https://www.npmjs.com/package/@alenfitz/opencode-copilot) — opencode-only version
- [`@alenfitz/spec-driven-dev`](https://www.npmjs.com/package/@alenfitz/spec-driven-dev) — Claude Code-only version (legacy)

## License

MIT
