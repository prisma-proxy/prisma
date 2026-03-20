---
description: "Self-evolution: the agent system improves its own skills, agents, and workflows based on experience. Auto-discovers patterns, updates prompts, creates new agents, and evolves autonomously."
globs:
  - ".claude/agents/**/*.md"
  - ".claude/skills/**/*.md"
  - ".claude/agent-memory/**/*.md"
  - "CLAUDE.md"
---

# Prisma Self-Evolution Skill

This skill enables the agent system to evolve itself — improving its own prompts, skills, agents, and workflows based on experience.

## When to Self-Evolve

The orchestrator triggers self-evolution after completing a demand when any of these conditions are met:

### 1. New Pattern Discovered
A recurring code pattern, architecture decision, or convention was found that isn't documented in any skill file.

**Action**: Update the relevant `.claude/skills/*.md` with the new pattern.

### 2. Agent Capability Gap
A task required capabilities that no existing agent covers, or an agent's prompt was insufficient for the task.

**Action**: Either update the agent's `.claude/agents/*.md` or create a new agent.

### 3. Workflow Friction
The execution protocol had unnecessary steps, missed steps, or inefficient ordering.

**Action**: Update `.claude/skills/prisma-workflow.md` or the orchestrator's execution protocol.

### 4. Repeated Mistakes
The same type of error occurred multiple times across conversations (tracked in agent memory).

**Action**: Add preventive guidance to the relevant skill or agent prompt.

### 5. New Project Dimension
The project expanded into a new area (e.g., mobile apps, new transport, new platform) that needs dedicated agent support.

**Action**: Create new agent + skill files, update the orchestrator's team table.

---

## Evolution Protocol

### Step 1: Identify What Changed
After completing a demand, the orchestrator reviews:
- What went well? (preserve in prompts)
- What went wrong? (fix in prompts)
- What was missing? (add to prompts)
- What was unnecessary? (remove from prompts)

### Step 2: Propose Changes
For each finding, determine:
- **Target file**: which `.claude/` file to update
- **Change type**: add | modify | remove | create
- **Rationale**: why this evolution improves future performance

### Step 3: Apply Changes
Update the relevant files:
- Skills: `.claude/skills/prisma-*.md`
- Agents: `.claude/agents/*.md`
- Agent teams doc: `.claude/agents/prisma-agent-teams.md`
- Orchestrator: `.claude/agents/prisma-orchestrator.md`
- Project instructions: `CLAUDE.md`

### Step 4: Record in Memory
Save the evolution rationale in agent memory for future reference:
- `.claude/agent-memory/prisma-orchestrator/`

---

## What Can Be Evolved

### Skill Files (`.claude/skills/`)
- Add new code patterns or conventions discovered
- Add new file paths or modules created
- Update architecture diagrams after structural changes
- Add new workflow steps for new capabilities
- Remove outdated patterns that no longer apply

### Agent Definitions (`.claude/agents/`)
- Expand agent descriptions with new capability examples
- Update file scope lists
- Add new decision rules or constraints
- Adjust model selection based on task complexity
- Create entirely new agents for new domains

### Orchestrator (`.claude/agents/prisma-orchestrator.md`)
- Add new demand patterns
- Update the team agent table
- Improve execution protocol based on experience
- Add new quality gate steps
- Update competitive intelligence

### Workflow (`.claude/skills/prisma-workflow.md`)
- Add new version-bearing files when created
- Update build commands for new targets
- Add new lint/test steps for new tooling

### Project Instructions (`CLAUDE.md`)
- Update workspace layout table when crates change
- Update key commands
- Add new workspace dependencies

---

## Evolution Constraints

1. **Never remove safety rules** — security, FFI safety, and crypto rules are immutable
2. **Never reduce test coverage** — only add or improve testing
3. **Never break the execution protocol** — additions are fine, removals need justification
4. **Always maintain backward compatibility** with existing conversations
5. **Keep prompts concise** — evolution should sharpen, not bloat
6. **Record why** — every evolution should have a rationale in agent memory

---

## Auto-Discovery Triggers

The orchestrator should check for evolution opportunities when:

| Trigger | What to Check |
|---------|--------------|
| New file created | Does the skill file list need updating? |
| New crate added | Update CLAUDE.md workspace layout, skill glob patterns |
| New dependency added | Update prisma-rust.md dependency section |
| New transport added | Update perf/security skills with new transport info |
| New platform target | Update platform-engineer agent, CI/CD workflows |
| Build failure pattern | Add to feature-validator known issues |
| Performance regression | Add to perf-engineer optimization targets |
| Security finding | Add to security-engineer checklist |

---

## Version Tracking

Each evolution should increment a meta-version tracked in the orchestrator prompt header:
- Current: Prisma Autonomous Orchestrator **v2**
- Bump the version when the orchestrator's core protocol changes
- This helps track the evolution of the AI system itself
