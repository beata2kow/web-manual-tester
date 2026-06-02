---
name: web-manual-tester
description: Runs manual browser QA scenarios from XLSX using a reusable global runner. Use when the user asks to execute manual web test scenarios, parse QA workbooks, retrieve OTP with Mailosaur, or produce manual test reports across repositories.
---

# Web Manual Tester

## When to use

Invoke this skill when the user asks to:

- Run manual web QA scenarios from an XLSX workbook
- Parse or inspect QA scenario workbooks
- Retrieve OTP via Mailosaur during browser testing
- Produce manual test reports for a market/web app repo

## Authoritative system prompt

Full execution rules, navigation tables, user-selection algorithm, and report format live in:

[`tools/web-manual-tester/web-manual-tester.prompt.md`](../../tools/web-manual-tester/web-manual-tester.prompt.md)

Read that file before executing scenarios interactively. Do not duplicate its rules here.

## Runner location

| Item | Path |
|------|------|
| Wrapper | `~/.agents/bin/web-manual-tester` |
| Main runner | `~/.agents/tools/web-manual-tester/execute-all-tests.ts` |
| Step executor | `~/.agents/tools/web-manual-tester/functions/executeScenarioSteps.ts` |

## Quick start

Playwright and XLSX must load from the **app repo** (`node_modules`). Always pass the repo root:

```bash
~/.agents/bin/web-manual-tester /path/to/web-market-apps \
  --config apps/produce-stand-e2e/config/dev.config.json \
  --xlsx libs/memory/your-scenarios.xlsx
```

Or from the repo root:

```bash
cd /path/to/web-market-apps
~/.agents/bin/web-manual-tester
```

Set `WEB_MANUAL_TESTER_REPO_ROOT=/path/to/repo` as an alternative to passing the repo as the first argument.

## CLI flags

| Flag | Purpose |
|------|---------|
| `--repo-root <path>` | App repo (required if not using wrapper) |
| `--xlsx <path>` | Workbook path (auto-discovered if omitted) |
| `--config <path>` | Environment config JSON |
| `--secrets <path>` | Mailosaur `.env` path |
| `--reports-dir <path>` | Output dir for markdown + JSON reports |
| `--area <name>` | Run one feature area |
| `--ids <id1,id2>` | Run specific scenario IDs |
| `--limit=<n>` | Limit number of feature areas |
| `--headed` | Visible browser |

## Operational cheat sheet

1. Sequential execution within a feature area; Mailosaur flows never parallel.
2. Runner executes steps via `executeScenarioStepsWithStrictRetry` (heuristic pass, then strict replay on blocked).
3. Fail on application error UI (`pageHealth.ts`); header match alone is not a pass.
4. Skip BDD preconditions (`stepPreconditions.ts`); attempt the real workflow.
5. Intent navigation and quoted-text click fallback (`intentActions.ts`, `executeScenarioSteps.ts`).
6. OTP via Mailosaur when user email is `@mailosaur.net`.
7. Reports: markdown + JSON sidecar in `--reports-dir` (default `.agent-reports/web-manual-tester`).
8. User memory: runner reuses the last successful user per feature area (`userSessionMemory`).

## Troubleshooting

**`Cannot find module 'playwright'` / `'xlsx'`** — pass `--repo-root` or use the wrapper. Do not use old in-repo paths like `libs/memory/agents/functions/`.

- Config auto-discovery fails → pass `--config`
- Mailosaur key missing → pass `--secrets`
- Multiple workbooks in repo → pass `--xlsx`
