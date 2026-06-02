# Web Manual Tester Agent

A smart QA execution agent for performing manual browser testing based on XLSX test scenarios.

## Overview

This agent performs **manual browser testing** based on XLSX scenarios. The `execute-all-tests.ts` runner drives Playwright and **executes workbook steps in order** via `functions/executeScenarioSteps.ts` (navigation, clicks, visibility checks). OTP-heavy steps may still require manual completion or Mailosaur.

Key features:
- Parses test scenarios from XLSX files
- Smart user selection with fallback logic
- Intelligent test ordering (create → edit → delete)
- OTP retrieval via Mailosaur
- Parallelization-aware (Mailosaur tests always serial)
- Concise reports with emoji status indicators

## Checklist: working with `web-manual-tester` (each repo)

Use this when you come back later and forget the steps.

1. **Configure the environment for your deployment**, including **Mailosaur** (API key + server). Put secrets where that repo expects them, or pass `--secrets <path>` when you run the runner. Ensure **app config** exists under `apps/*/config` as a `.json` file (first file alphabetically is used unless you pass `--config`).
2. **Install the project** — follow the **root README** of the repository you cloned (`npm install`, Node version, any NX/serve steps, etc.).
3. **Export test scenarios** to an `.xlsx` workbook (same format this parser expects).
4. **Put the workbook under `libs/memory/`** at the repository root — create `libs/memory` if it does not exist, then copy or save your file there (e.g. `libs/memory/my-scenarios.xlsx`). Commit it if your team allows scenario files in git; otherwise keep the file elsewhere and use an absolute `--xlsx` path.
5. **Run from the repository root** (terminal):

   ```bash
   web-manual-tester --xlsx libs/memory/<your-file>.xlsx
   ```

   If `web-manual-tester` is not found, add `~/.agents/bin` to your PATH (see below under Usage), then retry.

Optional: `--headed`, `--limit=5`, `--config`, `--secrets`, `--reports-dir`.

## Directory Structure

```
libs/memory/agents/
├── web-manual-tester.prompt.md    # Main agent prompt (system instructions)
├── execute-all-tests.ts           # Manual-runner helper for workbook scenarios
├── functions/
│   ├── index.ts                   # Exports all functions
│   ├── parseXlsxScenarios.ts      # Parse XLSX test file
│   ├── readConfig.ts              # Read environment config
│   ├── getAvailableUsers.ts       # Get users with capabilities
│   ├── orderScenarios.ts          # Apply test ordering logic
│   ├── getMailosaurOtp.ts         # Retrieve OTP from Mailosaur
│   └── createTestData.ts          # Test data creation guidance
├── reports/                       # Generated test reports
└── README.md                      # This file
```

## Usage

Run TypeScript helpers with `ts-node` via `npm exec` and set the module override explicitly:

```bash
# Shorthand alias (add to your shell)
alias ts-agent='TS_NODE_COMPILER_OPTIONS={"module":"CommonJS"} npm exec --yes -- ts-node'
```

### Run All Tests (Global Runner)

The runner script lives under `~/.agents/tools/`, but **Node must load `playwright` and `xlsx` from your cloned app repo** (`node_modules`). If Copilot runs the script without `--repo-root`, you will see `Cannot find module 'playwright'|'xlsx'`.

```bash
# Preferred wrapper (sets --repo-root and cds into repo)
~/.agents/bin/web-manual-tester /path/to/web-market-apps --config apps/.../dev.config.json

# From repo root
cd /path/to/web-market-apps && ~/.agents/bin/web-manual-tester

# Manual (always pass --repo-root)
TS_NODE_TRANSPILE_ONLY=1 TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' node -r ts-node/register \
  ~/.agents/tools/web-manual-tester/execute-all-tests.ts --repo-root "$PWD"

# Limit to first N feature areas
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node ~/.agents/tools/web-manual-tester/execute-all-tests.ts --repo-root "$PWD" --limit=5

# Run explicit workbook path
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node ~/.agents/tools/web-manual-tester/execute-all-tests.ts --repo-root "$PWD" --xlsx libs/memory/market_web_tst.xlsx

# Optional explicit paths if repo layout differs
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node ~/.agents/tools/web-manual-tester/execute-all-tests.ts --repo-root "$PWD" --config apps/my-app/config/local.json --secrets libs/my-e2e/src/secrets/.env --reports-dir .agent-reports/web-manual-tester
```

### 1. Parse Test Scenarios

```bash
TOOL=~/.agents/tools/web-manual-tester
REPO=/path/to/web-market-apps
RUN="TS_NODE_TRANSPILE_ONLY=1 TS_NODE_COMPILER_OPTIONS={\"module\":\"CommonJS\"} node -r ts-node/register"

$RUN $TOOL/functions/parseXlsxScenarios.ts --repo-root "$REPO"
$RUN $TOOL/functions/parseXlsxScenarios.ts --repo-root "$REPO" --area cherries
$RUN $TOOL/functions/parseXlsxScenarios.ts --repo-root "$REPO" --ids 54934803,54934804
```

### 2. Get Available Users

```bash
# List all users
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/getAvailableUsers.ts

# Filter by capability
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/getAvailableUsers.ts --capability admin
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/getAvailableUsers.ts --capability approvals
```

### 3. Retrieve OTP

```bash
# Get OTP for email
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/getMailosaurOtp.ts user@<mailosaur-server-id>.mailosaur.net

# Get OTP received after specific time
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/getMailosaurOtp.ts user@<mailosaur-server-id>.mailosaur.net --after 2026-04-18T10:00:00Z
```

### 4. Test Data Prerequisites

```bash
# Check what's needed for a scenario type
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/createTestData.ts crate
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' npm exec --yes -- ts-node libs/memory/agents/functions/createTestData.ts grower
```

## Execution Priority

Feature areas are executed in this order:

**Phase 1 - Mailosaur-dependent (SERIAL):**
1. crates
2. standing-crates
3. orders (with OTP)

**Phase 2 - Standard features (can parallelize):**
4. audit
5. authentication
6. baskets
7. pickings
8. harvest-logs
9. cherries
10. growers
11. dashboard
12. barter
13. seedlings
14. messages
15. notifications
16. self-service-seedlings
17. wholesale
18. user-management

**Phase 3 - User data modification (LAST):**
19. user-profile-otp (may lock user, run first in this phase)
20. user-profile

## Test Ordering Within Areas

Scenarios are reordered within each area:
1. view/list - Read operations
2. create - Generate test data
3. edit - Modify existing
4. approve - State transitions
5. reject - Negative flows
6. cancel - Soft removal
7. delete - Hard removal

## Report Format

Reports are saved to `libs/memory/agents/reports/[area]-YYYY-MM-DD.md`:

```markdown
# Manual Test Report - Cherries - 2026-04-18

## Summary
- Total: 18 | ✅ Passed: 15 | ❌ Failed: 2 | ⚠️ Blocked: 1

## Results

### ✅ Passed
- 54934803 - View list of cherries
- 54934804 - View cherry details

### ❌ Failed
- 54934806 - Change STONE code
  > STONE change button not visible. Location: Cherry Details > Quick Actions.

### ⚠️ Blocked
- 54934810 - Activate physical cherry
  > No inactive cherries available for testing.
```

## Parallelization Rules

| Scenario Type | Parallel? | Reason |
|--------------|-----------|--------|
| Mailosaur tests | NO | OTP conflicts |
| Same feature area | NO | Sequential execution |
| Different non-Mailosaur areas | YES | Safe to parallelize |

## Configuration

### Environment Config
Default discovery: first existing `apps/*/config` directory in alphabetical order.

The agent reads the first `.json` file from the selected config directory in alphabetical order.

Contains:
- Base URL
- Available test users
- OTP configuration

### Secrets
Location fallback order:
- `libs/stand-a-e2e/src/secrets/.env`
- `libs/stand-b-e2e/src/secrets/.env`

Supported variables:
- `MAILOSAUR_API_KEY` or `STAND_A_MAILOSAUR_API_KEY` or `STAND_B_MAILOSAUR_API_KEY`
- `MAILOSAUR_SERVER` or `STAND_A_MAILOSAUR_SERVER` or `STAND_B_MAILOSAUR_SERVER` (no default — provide your own server id)

## Extending to Other Applications

This agent is designed to be reusable. To use with a different application:

1. Create a new config file with:
   - `baseUrl` - Application URL
   - `users` - Available test users with credentials

2. Update the XLSX path to point to your test scenarios

3. The agent will:
   - Auto-detect user capabilities from config
   - Adapt navigation based on available menus
   - Use the same OTP retrieval if Mailosaur is configured

## Known Limitations

Some scenarios may remain blocked due to complex prerequisite workflows or environment-specific requirements:

### Cancel/Delete Crate Scenarios
**Affected scenarios:**
- `54934798` - Cancel a crate order
- `54934887` - Cancel a standing crate order
- `54934888` - Delete a standing crate order

**Root cause:**
These scenarios require a multi-step prerequisite workflow described in the scenario steps:
1. Create a crate (status: "Entered")
2. **Approve the crate first** (requires OTP/freshness check)
3. After approval, crate enters "Waiting for another approval" status
4. Only THEN can the crate be cancelled via three-dots menu

**Why the agent struggles:**
- Crate approval requires OTP via Mailosaur (freshness check)
- Even with OTP, may require a **second approver** (different user)
- The "Cancel" option only appears in the row menu for crates in specific intermediate status

**Workarounds:**
1. **Manual preparation**: Have a human pre-approve some crates to the correct status
2. **Use API**: Create crates directly via API with the required status
3. **Two-user workflow**: Run approval with one user, then cancel with another

### OTP/Freshness check Scenarios
Scenarios requiring OTP completion may be blocked if:
- Mailosaur credentials are not configured
- The OTP flow UI differs from expected selectors
- Network latency causes OTP retrieval timing issues

### Scenarios with Complex Data Prerequisites
Some scenarios require data in very specific states that cannot be easily created:
- Items in "Rejected" status (require rejection flow)
- Partially approved items (require multi-approver setup)
- Historical data with specific date ranges

### User Management Unlock Approval Scenarios
**Affected scenarios:**
- `54935104` - Approve unlock request
- `54935105` - Reject unlock request

**Root cause:**
These scenarios require existing unlock requests in a pending state. In the current environment, no pending unlock requests were available, so approve/reject actions had no executable data.

**Why the agent struggles:**
- The runner can navigate to User Management and execute admin actions
- But it cannot reliably create unlock-request test data through UI/API in a way that guarantees a pending approval/rejection item

**Workarounds:**
1. **Manual preparation**: Trigger one or more user unlock requests before execution
2. **Pre-seeded test data**: Seed pending unlock requests in environment setup
3. **Two-user setup**: One user triggers lock/unlock workflow, another performs approve/reject

### User Profile Approval/Removal Data Scenarios
**Affected scenarios:**
- `54935092` - Approve user profile changes
- `54935093` - Reject user profile changes
- `54935090` - Remove Email addresses
- `54935091` - Remove phone numbers

**Root cause:**
These scenarios require profile-change records already present in specific workflow states (pending approval/rejection and, for removals, data that has gone through prerequisite transitions). In the current environment, those records were missing.

**Why the agent struggles:**
- The runner can navigate to profile pages and detect edit affordances
- But it cannot reliably create profile-change workflow items with the exact intermediate statuses required by approve/reject/remove scenarios

**Workarounds:**
1. **Manual preparation**: Submit profile change requests first so items appear in pending queues
2. **Pre-seeded workflow data**: Seed approval/rejection/removal candidates in test environment setup
3. **Two-user workflow**: Use one user to submit changes and another approver user to process them

---

## Troubleshooting

### OTP Not Received
- Check Mailosaur API key in secrets
- Verify email address matches Mailosaur inbox
- Ensure `receivedAfter` timestamp is before OTP trigger

### Permission Denied
- Agent will automatically try alternative users
- Check if any user has required permission
- Review scenario requirements

### Test Data Missing
- Run prerequisite scenario first
- Use `createTestData.ts --suggest` for guidance
- Check if data exists in different status

## Test Executor

The `execute-all-tests.ts` is the main test executor that:
- Full system prompt guidelines
- Smart user selection with context switching
- Prerequisite workflow analysis (create → approve → cancel)
- OTP handling via Mailosaur
- Reports per feature area
