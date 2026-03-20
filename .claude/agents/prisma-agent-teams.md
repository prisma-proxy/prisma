# Prisma Agent Teams — Self-Evolving Autonomous Architecture v2

## System Overview

The Prisma AI agent system is a self-evolving, autonomous development engine. The user sends demands in plain language (features, improvements, bug fixes, releases), and the system autonomously plans, implements, tests, versions, and commits — then evolves its own capabilities based on what it learned.

```
┌──────────────────────────────────────────────────────────────────┐
│                    USER DEMAND (plain language)                   │
│  "add feature X" / "optimize Y" / "fix bug Z" / "release 1.0"  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│              PRISMA ORCHESTRATOR (autonomous brain)               │
│                                                                  │
│  Analyze → Plan → Execute → Quality Gates → Version → Commit    │
│                    │                                    │        │
│                    ▼                                    ▼        │
│            Spawn Team Agents              Self-Evolution Check   │
│            (parallel execution)           (improve own prompts)  │
└────┬────────┬────────┬────────┬────────┬────────┬────────┬──────┘
     │        │        │        │        │        │        │
     ▼        ▼        ▼        ▼        ▼        ▼        ▼
  ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
  │Rust  ││Perf  ││Secu- ││UX    ││Plat- ││QA    ││Docs  │
  │Archi-││Engi- ││rity  ││Engi- ││form  ││Engi- ││Engi- │
  │tect  ││neer  ││Engi- ││neer  ││Engi- ││neer  ││neer  │
  │      ││      ││neer  ││      ││neer  ││      ││      │
  └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘
     │        │        │        │        │        │        │
     └────────┴────────┴────────┴────────┴────────┴────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │Feature Validator│
                   │(post-impl check)│
                   └─────────────────┘
```

---

## Agent Registry

### Orchestrator (the brain)

| Agent | File | Model | Role |
|-------|------|-------|------|
| `prisma-orchestrator` | `.claude/agents/prisma-orchestrator.md` | opus | Autonomous coordinator — receives demands, plans, executes, spawns teams, versions, commits, self-evolves |

### Team Agents (specialists)

| Agent | File | Model | Domain |
|-------|------|-------|--------|
| `rust-architect` | `.claude/agents/rust-architect.md` | opus | Cross-crate Rust implementation, type design, workspace refactoring |
| `perf-engineer` | `.claude/agents/perf-engineer.md` | opus | Hot path optimization, transport tuning, benchmarking vs competitors |
| `security-engineer` | `.claude/agents/security-engineer.md` | opus | Protocol, crypto, anti-detection, camouflage, traffic analysis resistance |
| `ux-engineer` | `.claude/agents/ux-engineer.md` | opus | GUI (Tauri), dashboard (Next.js), CLI UX, competitive with Clash/v2rayN |
| `platform-engineer` | `.claude/agents/platform-engineer.md` | opus | FFI, mobile (iOS/Android), TUN, system proxy, build system |
| `qa-engineer` | `.claude/agents/qa-engineer.md` | opus | Tests, coverage, benchmarks, CI/CD, fuzzing |
| `docs-engineer` | `.claude/agents/docs-engineer.md` | opus | README sync (EN/CN), CLAUDE.md, Docusaurus, API docs, changelogs |
| `feature-validator` | `.claude/agents/feature-validator.md` | inherit | Post-implementation validation, bug diagnosis, pre-commit checks |

### Skill Files (domain knowledge)

| Skill | File | Domain |
|-------|------|--------|
| `prisma-rust` | `.claude/skills/prisma-rust.md` | Rust architecture, conventions, crate map |
| `prisma-perf` | `.claude/skills/prisma-perf.md` | Performance patterns, profiling, optimization |
| `prisma-security` | `.claude/skills/prisma-security.md` | Threat model, crypto, protocol security |
| `prisma-ux` | `.claude/skills/prisma-ux.md` | UI/UX patterns, component library, i18n |
| `prisma-platform` | `.claude/skills/prisma-platform.md` | FFI rules, platform targets, mobile |
| `prisma-qa` | `.claude/skills/prisma-qa.md` | Testing stack, CI/CD, coverage |
| `prisma-docs` | `.claude/skills/prisma-docs.md` | Documentation sync workflow |
| `prisma-workflow` | `.claude/skills/prisma-workflow.md` | Build, test, version, commit, push |
| `prisma-orchestrator` | `.claude/skills/prisma-orchestrator.md` | Feature orchestration patterns |
| `prisma-evolve` | `.claude/skills/prisma-evolve.md` | Self-evolution protocol |

---

## How It Works

### 1. User Sends Demand
The user types a plain-language request. Examples:
- "add QUIC 0-RTT resumption"
- "optimize relay throughput to beat sing-box"
- "fix DNS leak on iOS"
- "release 1.0.0"
- "improve error messages in the CLI"
- "make the dashboard faster"
- "add multi-hop proxy chaining"

### 2. Orchestrator Analyzes
The orchestrator classifies the demand:
- **Type**: feature | improvement | optimization | bugfix | refactor | release | audit
- **Scope**: which crates, frontends, platforms
- **Complexity**: simple | medium | complex
- **Version impact**: patch | minor | major

### 3. Orchestrator Plans & Executes
- **Simple tasks** (1-2 files): orchestrator handles directly
- **Medium tasks** (2-3 crates): orchestrator handles with sequential changes
- **Complex tasks** (cross-cutting): spawns team agents in parallel

### 4. Quality Gates
Every change passes through:
```
cargo fmt → cargo clippy → cargo test → cargo build --release
```
Plus frontend builds if touched.

### 5. Version Bump & Commit
- Automatic version bump based on change type
- Conventional commit message (no co-author tags)
- Specific file staging (never blind `git add -A`)

### 6. Self-Evolution
After every demand, the orchestrator checks:
- Should any skill file be updated?
- Should any agent prompt be improved?
- Should new agents be created?
- Should agent memory be recorded?

---

## Demand → Agent Routing

| Demand Pattern | Primary Agent | Supporting Agents |
|---------------|--------------|-------------------|
| "add feature X" | orchestrator | rust-architect, qa-engineer, docs-engineer |
| "optimize/speed up X" | orchestrator | perf-engineer, qa-engineer |
| "fix security issue X" | orchestrator | security-engineer, qa-engineer |
| "improve UI/UX of X" | orchestrator | ux-engineer, docs-engineer |
| "add mobile support for X" | orchestrator | platform-engineer, ux-engineer |
| "fix bug X" | orchestrator | feature-validator, qa-engineer |
| "release vX.Y.Z" | orchestrator | qa-engineer, docs-engineer |
| "audit/review X" | orchestrator | (domain-specific agents) |
| "evolve/improve the project" | orchestrator | all agents as needed |

---

## Self-Evolution Mechanism

The system improves itself through three channels:

### 1. Skill Evolution
Skills (`.claude/skills/*.md`) capture domain knowledge. After each task:
- New patterns discovered → add to relevant skill
- Outdated patterns → update or remove
- New file paths or modules → update glob patterns and file lists

### 2. Agent Evolution
Agent prompts (`.claude/agents/*.md`) define capabilities. After each task:
- Insufficient agent scope → expand description and rules
- New agent needed → create new `.md` file
- Agent model wrong for task complexity → adjust model field

### 3. Memory Evolution
Agent memory (`.claude/agent-memory/*/`) stores institutional knowledge:
- Architecture decisions and rationale
- Performance hotspots and findings
- Security patterns discovered
- Bug patterns and their causes
- Cross-crate dependency chains

---

## Competitive Targets

| Dimension | Competitors | Prisma Advantage |
|-----------|------------|-----------------|
| Performance | xray-core, sing-box | Rust zero-cost, no GC, zero-copy relay |
| Protocol | VLESS/Reality, ShadowTLS | PrismaVeil v5, Salamander, XPorta |
| Desktop UX | Clash Verge, v2rayN | Tauri native perf, integrated dashboard |
| Mobile UX | Shadowrocket, v2rayNG | Shared Rust core, native UI per platform |
| Dashboard | Clash Verge built-in | Dedicated Next.js dashboard with real-time |

---

## Usage

To use this system, simply invoke `prisma-orchestrator` with any demand:

```
User: "add connection pooling warmup"
→ Orchestrator analyzes, plans, implements, tests, bumps 0.9.x → 0.9.x+1, commits

User: "release 1.0.0"
→ Orchestrator runs full audit, fixes issues, bumps to 1.0.0, syncs docs, commits + tags

User: "the QUIC transport is slow compared to sing-box"
→ Orchestrator spawns perf-engineer to profile, identify bottleneck, optimize, benchmark, ship
```

The system gets smarter with every interaction through self-evolution.
