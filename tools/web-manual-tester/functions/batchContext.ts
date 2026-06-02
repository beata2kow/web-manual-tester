import { GoalVerificationResult, GoalVerificationStatus } from './goalVerification';
import { TestScenario } from './parseXlsxScenarios';
import { StepExecutorDeps } from './stepExecutorTypes';

export type StepRunStatus = 'passed' | 'passed-with-deviation' | 'failed' | 'blocked';

export interface CrateListState {
  onCratesJourney: boolean;
  listContainerVisible: boolean;
  isEmpty: boolean;
  rowCount: number;
  achInternalTabsVisible: boolean;
  emptyStateMessage: string;
}

const CRATE_LIST_ROOT = 'app-crate-manager-list, [data-role="crate-manager-list"]';
const CRATE_EMPTY = '[data-role="crate-manager-empty-search"]';
const CRATE_ROW =
  'app-crate-manager-list table tbody tr, app-crate-manager-list [data-role="list-item"], app-crate-manager-list [data-role="order-col-selection"]';

function isCratesJourneyUrl(url: string): boolean {
  return /\/crates\b|\/deliveries\/ach\b/i.test(url);
}

export async function getCrateListState(deps: StepExecutorDeps): Promise<CrateListState> {
  const url = deps.page.url();
  const onCratesJourney = isCratesJourneyUrl(url);

  const listContainerVisible = await deps.page
    .locator(CRATE_LIST_ROOT)
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  const emptyLocator = deps.page.locator(CRATE_EMPTY).first();
  const emptyVisible = await emptyLocator.isVisible({ timeout: 1500 }).catch(() => false);
  let emptyStateMessage = '';
  if (emptyVisible) {
    emptyStateMessage = (await emptyLocator.textContent())?.replace(/\s+/g, ' ').trim() || 'Empty crates list';
  }

  const genericEmpty = Boolean(
    await deps.locatorAnyVisible(
      [
        'text=No crates',
        'text=No results',
        'text=No data',
        'text=No items to display',
        '[data-role="empty-state"]'
      ],
      1200
    )
  );

  let rowCount = 0;
  if (listContainerVisible) {
    try {
      rowCount = await deps.page.locator(`app-crate-manager-list ${CRATE_ROW}`).count();
      if (rowCount === 0) {
        rowCount = await deps.page.locator(CRATE_ROW).count();
      }
    } catch {
      rowCount = 0;
    }
  }

  const achTab = await deps.page
    .locator('[role="tab"]:has-text("ACH"), [role="tablist"] a:has-text("ACH"), .nav-item:has-text("ACH")')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  const internalTab = await deps.page
    .locator('[role="tab"]:has-text("Internal"), [role="tablist"] a:has-text("Internal"), .nav-item:has-text("Internal")')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  const isEmpty =
    emptyVisible ||
    genericEmpty ||
    !listContainerVisible ||
    (listContainerVisible && rowCount === 0);

  return {
    onCratesJourney,
    listContainerVisible,
    isEmpty,
    rowCount,
    achInternalTabsVisible: achTab || internalTab,
    emptyStateMessage: emptyStateMessage || (genericEmpty ? 'No crates found (empty state)' : '')
  };
}

function stepNeedsExistingCrates(text: string): boolean {
  return /to\s+be\s+(?:approved|rejected|cancelled|deleted)|approve|reject|cancel|delete|export\s+crate\s+details|crate\s+details|three\s+dots|row\s+menu/i.test(
    text
  );
}

function stepIsViewCratesListOnly(text: string): boolean {
  return /view\s+crates|see\s+list\s+of\s+crates|list\s+of\s+crates/i.test(text) && !stepNeedsExistingCrates(text);
}

function isCratesListTabStep(text: string): boolean {
  return (
    /ACH\s+or\s+Internal\s+tab/i.test(text) ||
    (/tab/i.test(text) && /list\s+of\s+crates/i.test(text)) ||
    /see\s+list\s+of\s+crates\s+to\s+be/i.test(text)
  );
}

async function ensureOnCratesList(deps: StepExecutorDeps): Promise<boolean> {
  if (isCratesJourneyUrl(deps.page.url())) {
    return true;
  }

  const navigated = await deps.navigateToDirectUrl(['/crates/crates/manage/list', '/crates/']);
  if (navigated) {
    await deps.sleep(1500);
    return true;
  }

  const menuPath = { section: 'Move produce', items: ['Crates'] };
  if (await deps.navigateToMenu(menuPath)) {
    await deps.sleep(1500);
    return true;
  }

  return deps.clickAppMenuItem('Crates', 'Move produce');
}

/**
 * Interprets workbook steps that mention ACH/Internal tabs (US wording) on the application's crates list.
 */
export async function tryInterpretCratesListStep(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<{ handled: boolean; ok: boolean; status: StepRunStatus; note: string } | null> {
  if (scenario.area !== 'crates' && !/crate/i.test(text)) {
    return null;
  }

  if (!isCratesListTabStep(text)) {
    return null;
  }

  await ensureOnCratesList(deps);
  const state = await getCrateListState(deps);
  const deviationParts: string[] = [];

  if (!state.achInternalTabsVisible) {
    deviationParts.push(
      'Workbook step mentions "ACH or Internal tab"; the application uses a single **Crates** list (Move produce → Crates, `/crates/…`) with no ACH/Internal tabs.'
    );
  }

  if (state.isEmpty && stepNeedsExistingCrates(text)) {
    const note = [
      ...deviationParts,
      'Crates list is **empty** — there are no crates to approve/reject/cancel/delete yet.',
      'Prerequisite: upload or create a crate first (e.g. run "Upload CSV standing crate" / crate file upload with `apps/produce-stand-e2e/src/specs/crates/standard.csv`, or duplicate-upload scenario).'
    ].join(' ');
    console.log(`    ${note}`);
    return { handled: true, ok: false, status: 'blocked', note };
  }

  if (state.isEmpty && stepIsViewCratesListOnly(text)) {
    const note = [
      ...deviationParts,
      `Crates journey reached; list is empty (${state.emptyStateMessage || 'no rows'}). This is expected when no crate was uploaded before.`
    ].join(' ');
    console.log(`    Verified crates list (empty)`);
    return {
      handled: true,
      ok: true,
      status: deviationParts.length ? 'passed-with-deviation' : 'passed',
      note
    };
  }

  if (state.rowCount > 0) {
    const note = deviationParts.join(' ');
    console.log(`    Verified crates list (${state.rowCount} row(s) visible)`);
    return {
      handled: true,
      ok: true,
      status: deviationParts.length ? 'passed-with-deviation' : 'passed',
      note
    };
  }

  if (state.achInternalTabsVisible) {
    for (const tabLabel of ['ACH', 'Internal']) {
      const tab = await deps.locatorAnyVisible(
        [`[role="tab"]:has-text("${tabLabel}")`, `.nav-item:has-text("${tabLabel}")`],
        1500
      );
      if (tab) {
        await tab.click({ force: true });
        await deps.sleep(1200);
        console.log(`    Clicked tab: ${tabLabel}`);
        const after = await getCrateListState(deps);
        if (after.isEmpty && stepNeedsExistingCrates(text)) {
          return {
            handled: true,
            ok: false,
            status: 'blocked',
            note: `Tab "${tabLabel}" opened but crates list is still empty — create a crate first.`
          };
        }
        return {
          handled: true,
          ok: true,
          status: 'passed-with-deviation',
          note: deviationParts.join(' ') || `Used ${tabLabel} tab as in workbook.`
        };
      }
    }
  }

  if (!state.listContainerVisible || state.isEmpty) {
    if (stepNeedsExistingCrates(text)) {
      const note = [
        ...deviationParts,
        'Crates list is not available or empty — upload a crate first (`apps/produce-stand-e2e/src/specs/crates/standard.csv`).'
      ].join(' ');
      return { handled: true, ok: false, status: 'blocked', note };
    }
  }

  return {
    handled: true,
    ok: false,
    status: 'blocked',
    note: deviationParts.join(' ') || 'Crates list step could not be completed'
  };
}

function isViewOnlyCrateScenario(scenario: TestScenario, text: string): boolean {
  return (
    scenario.actionType === 'view' ||
    /view\s+crate|file\s+upload\s+overview/i.test(scenario.name) ||
    (/see\s+list\s+of\s+crates/i.test(text) && !/export|approve|reject|cancel|delete/i.test(`${scenario.name} ${text}`))
  );
}

export async function verifyCrateContentGoal(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  if (scenario.area !== 'crates' && !/crate/i.test(text)) {
    return null;
  }

  if (!/crate\s+details|involved\s+pickings|export.*crate|ach-delivery-list|internal-delivery-list|standard-delivery-list/i.test(text)) {
    return null;
  }

  await ensureOnCratesList(deps);
  const state = await getCrateListState(deps);

  if (state.isEmpty) {
    const onCrates = state.onCratesJourney || state.listContainerVisible || state.emptyStateMessage;
    if (isViewOnlyCrateScenario(scenario, text) && onCrates) {
      return {
        ok: true,
        status: 'passed-with-deviation',
        note: [
          'Reached **Crates** list (`/crates/crates/manage/list`); list is **empty** (no prior upload).',
          'Workbook expected crate details — not shown until a crate exists.',
          state.emptyStateMessage ? `Empty state: ${state.emptyStateMessage}` : ''
        ]
          .filter(Boolean)
          .join(' ')
      };
    }

    return {
      ok: false,
      status: 'blocked',
      note: [
        'Cannot verify crate details or export — **crates list is empty**.',
        'Prerequisite: upload a crate file first (`apps/produce-stand-e2e/src/specs/crates/standard.csv`) via New crate → Upload a file, then re-run this scenario.'
      ].join(' ')
    };
  }

  if (/crate\s+details\s+shows\s+up|involved\s+pickings/i.test(text)) {
    const rowSelectors = [
      'app-crate-manager-list table tbody tr',
      'app-crate-manager-list [data-role="list-item"]',
      CRATE_ROW
    ];
    for (const sel of rowSelectors) {
      const row = deps.page.locator(sel).first();
      if (await row.isVisible({ timeout: 2000 }).catch(() => false)) {
        await row.click({ force: true });
        await deps.sleep(1500);
        break;
      }
    }

    const detailsVisible = Boolean(
      await deps.locatorAnyVisible(
        [
          'app-crates-manager-details-view',
          'app-crates-manager-details-view:visible',
          '[data-role="crate-details"]',
          'app-crate-manager-details'
        ],
        5000
      )
    );

    if (detailsVisible) {
      console.log('    Verified crate details panel visible');
      return { ok: true, status: 'passed', note: '' };
    }

    return {
      ok: false,
      status: 'failed',
      note: 'Crate rows exist but details panel did not appear after selecting a row'
    };
  }

  if (/ach-delivery-list|internal-delivery-list|standard-delivery-list|\.csv/i.test(text)) {
    return {
      ok: false,
      status: 'blocked',
      note: 'Export verification requires an existing crate in the list — list has rows but export step needs manual/download confirmation'
    };
  }

  return null;
}
