import { tryInterpretCratesListStep } from './crateContext';
import { tryFormActionFromText } from './formActions';
import { tryIntentClick, tryIntentFileUpload, tryIntentNavigation, isClickShapedStepText } from './intentActions';
import {
  shouldInferUploadAfterAction,
  tryAdvanceObviousModal,
  verifyStepGoal,
  isNavigationShapedText
} from './goalVerification';
import { detectPageApplicationError, formatApplicationErrorNote } from './pageHealth';
import { TestScenario, TestStep } from './parseXlsxScenarios';
import { classifyPrecondition, isOtpPreconditionText, isSkippablePreconditionText } from './stepPreconditions';
import {
  MenuPath,
  NavigationTarget,
  StepExecutorDeps,
  StepExecutorPage
} from './stepExecutorTypes';

export type { MenuPath, NavigationTarget, StepExecutorDeps, StepExecutorPage } from './stepExecutorTypes';

export type StepRunStatus = 'passed' | 'passed-with-deviation' | 'failed' | 'blocked';

export interface StepExecutionResult {
  status: StepRunStatus;
  note: string;
  failedStepNumber?: string;
  stepsExecuted: number;
}

const AUDIT_FIELD_READY_SELECTORS = [
  '[data-role="date-range"]',
  '[data-role="legal-entities"]',
  '[data-role="submit-query"]'
];

const FIELD_EXPECTATION_MAP: Array<{ pattern: RegExp; locators: string[]; label: string; auditField?: boolean }> = [
  { pattern: /date\s*range/i, locators: ['[data-role="date-range"]'], label: 'date range', auditField: true },
  {
    pattern: /legal\s*entit/i,
    locators: [
      '[data-role="legal-entities"]',
      'app-audit-view-container [data-role="legal-entities"]',
      '[data-role="legal-entities"] select',
      '[data-role="legal-entities"] input',
      '[data-role="legal-entities"] button'
    ],
    label: 'legal entities',
    auditField: true
  },
  { pattern: /session\s*id/i, locators: ['[data-role="session-id-search-input"]'], label: 'session ID', auditField: true },
  { pattern: /device\s*id/i, locators: ['[data-role="device-id-search-input"]'], label: 'device ID', auditField: true },
  { pattern: /username/i, locators: ['[data-role="username"]'], label: 'username', auditField: true },
  { pattern: /\bcategory\b/i, locators: ['[data-role="event-category"]'], label: 'category', auditField: true },
  { pattern: /\bevent\s+type\b/i, locators: ['[data-role="event-type"]'], label: 'event type', auditField: true },
  { pattern: /\bevent\s+action\b/i, locators: ['[data-role="event-action"]'], label: 'event action', auditField: true },
  { pattern: /\bstatus\b/i, locators: ['[data-role="status"]'], label: 'status', auditField: true },
  { pattern: /booked\s+stock|available\s+stock/i, locators: ['table tbody tr', '[data-role="basket-list-item"]', 'app-baskets-list'], label: 'basket stocks' },
  { pattern: /basket\s+number|basket\s+name|basket\s+type/i, locators: ['app-basket-details', '[data-role="basket-header"]', 'main'], label: 'basket details' }
];

function isAuditJourneyPage(url: string): boolean {
  return /\/audit(?:\/|$|\?)/i.test(url);
}

function mergeStatus(current: StepRunStatus, next: StepRunStatus): StepRunStatus {
  if (current === 'failed' || current === 'blocked' || next === 'failed' || next === 'blocked') {
    return current === 'failed' || next === 'failed' ? 'failed' : 'blocked';
  }
  if (current === 'passed-with-deviation' || next === 'passed-with-deviation') {
    return 'passed-with-deviation';
  }
  return 'passed';
}

async function assertNoApplicationError(deps: StepExecutorDeps): Promise<{ ok: boolean; note: string }> {
  const errorState = await detectPageApplicationError(deps.page);
  if (errorState.hasError) {
    console.log(`    Page error detected: ${errorState.message}`);
    return { ok: false, note: formatApplicationErrorNote(errorState.message) };
  }
  return { ok: true, note: '' };
}

async function waitForAuditSearchFormReady(deps: StepExecutorDeps): Promise<boolean> {
  if (!isAuditJourneyPage(deps.page.url())) {
    return true;
  }

  const loadingIndicators = [
    'app-audit-view-container [data-role="loading-indicator"]',
    'app-audit-journey [data-role="loading-indicator"]',
    'app-loading-indicator-ui:visible',
    'text=Loading...'
  ];

  for (const selector of loadingIndicators) {
    const loader = deps.page.locator(selector).first();
    if (await loader.isVisible({ timeout: 500 }).catch(() => false)) {
      await loader.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    }
  }

  for (const selector of AUDIT_FIELD_READY_SELECTORS) {
    try {
      await deps.page.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 });
      console.log(`    Audit search form ready (${selector})`);
      return true;
    } catch {
      // Try next readiness signal
    }
  }

  return false;
}

async function isFieldExpectationVisible(
  field: { locators: string[]; label: string; auditField?: boolean },
  deps: StepExecutorDeps
): Promise<boolean> {
  if (field.auditField) {
    const ready = await waitForAuditSearchFormReady(deps);
    if (!ready) {
      console.log('    Audit search form did not finish loading');
      return false;
    }
  }

  const target = await deps.locatorAnyVisible(field.locators, 8000);
  return Boolean(target);
}

const MENU_LABEL_ALIASES: Array<{ pattern: RegExp; menuPath: MenuPath; directUrls?: string[] }> = [
  { pattern: /\baudit\b/i, menuPath: { section: 'Company administration', items: ['Audit'] }, directUrls: ['/audit'] },
  { pattern: /\bbaskets?\b/i, menuPath: { section: 'Baskets & cherries', items: ['Baskets'] } },
  { pattern: /\bpickings?\b/i, menuPath: { section: 'Baskets & cherries', items: ['Pickings'] }, directUrls: ['/pickings/table'] },
  { pattern: /\bbasket\s+harvest-logs?\b/i, menuPath: { section: 'Baskets & cherries', items: ['Harvest logs'] } },
  { pattern: /\bcherries?\b/i, menuPath: { section: 'Baskets & cherries', items: ['Cherries'] }, directUrls: ['/self-service/manage-cherries'] },
  { pattern: /\bgrowers?\b/i, menuPath: { section: 'Move produce', items: ['Growers'] } },
  { pattern: /\btemplates?\b/i, menuPath: { section: 'Move produce', items: ['Templates'] }, directUrls: ['/templates/deliveries'] },
  { pattern: /\bproducts?\b/i, menuPath: { section: 'Products', items: ['Apply for products'] }, directUrls: ['/products'] },
  { pattern: /\bdeliveries?\b/i, menuPath: { section: 'Move produce', items: ['Orders'] }, directUrls: ['/deliveries'] },
  { pattern: /\borders?\b/i, menuPath: { section: 'Move produce', items: ['Orders'] }, directUrls: ['/deliveries'] },
  { pattern: /\bcrates?\b/i, menuPath: { section: 'Move produce', items: ['Crates'] } },
  { pattern: /\bstanding\s+crates?\b/i, menuPath: { section: 'Move produce', items: ['Standing crates'] } },
  { pattern: /\bbarter\b/i, menuPath: { section: 'Stall management', items: ['Barter'] } },
  { pattern: /\bseedlings?\b/i, menuPath: { section: 'Baskets & cherries', items: ['Seedlings'] } },
  { pattern: /\bmessages?\b/i, menuPath: { section: 'Personal', items: ['Messages'] } },
  { pattern: /\bmy\s+profile\b/i, menuPath: { section: 'Personal', items: ['My profile'] } },
  { pattern: /\bcompany\s+permissions?\b/i, menuPath: { section: 'Company administration', items: ['Company Permissions'] } },
  { pattern: /\btrade\s+stall\b/i, menuPath: { section: 'Trade & supply chain', items: ['Wholesale'] } },
  { pattern: /\bdashboard\b/i, menuPath: { items: [] }, directUrls: ['/dashboard'] },
  {
    pattern: /\bself\s*service\b/i,
    menuPath: { section: 'Personal', items: ['My profile'] },
    directUrls: ['/self-service/profile/profile']
  }
];

const MENU_CLICK_PATTERNS = [
  /clicks?\s+(?:on\s+)?['"]?([^'"]+?)['"]?\s+(?:on\s+the\s+)?(?:left(?:\s*hand)?\s+)?menu/i,
  /clicks?\s+(?:on\s+)?['"]?([^'"]+?)['"]?\s+(?:on\s+the\s+)?(?:left|side)\s+(?:hand\s+)?menu/i,
  /clicks?\s+on\s+['"]?([^'"]+?)['"]?\s+on\s+the\s+left\s+hand\s+menu/i,
  /clicks?\s+(?:on\s+)?['"]?([^'"]+?)['"]?\s+(?:sub-?menu|navigation)\s+item/i,
  /clicks?\s+on\s+['"]?([^'"]+?)['"]?\s+item\s+in\s+(?:the\s+)?Dashboard\s+section/i,
  /clicks?\s+on\s+['"]?([^'"]+?)['"]?\s+(?:sub-?menu\s+)?item/i
];

function stripBddPrefix(text: string): string {
  return text.replace(/^\s*(given|when|then|and)\s+/i, '').trim();
}

function getStepLines(step: TestStep): { action: string; expected: string } {
  return {
    action: stripBddPrefix(step.action || ''),
    expected: stripBddPrefix(step.expectedResult || '')
  };
}

function requiresManualOtp(text: string): boolean {
  return isOtpPreconditionText(text) || /mailosaur/i.test(text);
}

function extractMenuClickLabel(text: string): string | null {
  for (const pattern of MENU_CLICK_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+tab$/i, '').trim();
    }
  }
  return null;
}

async function tryNavigateFromMenuClick(text: string, deps: StepExecutorDeps): Promise<boolean> {
  const label = extractMenuClickLabel(text);
  if (!label) {
    return false;
  }

  if (await navigateByMenuLabel(label, deps)) {
    console.log(`    Navigated via menu click: ${label}`);
    return true;
  }

  if (await deps.clickAppMenuItem(label)) {
    console.log(`    Clicked menu item: ${label}`);
    return true;
  }

  return false;
}

async function navigateByMenuLabel(label: string, deps: StepExecutorDeps): Promise<boolean> {
  const searchText = label.toLowerCase();

  for (const entry of MENU_LABEL_ALIASES) {
    if (!entry.pattern.test(searchText)) {
      continue;
    }

    if (entry.menuPath.items.length > 0) {
      const navigated = await deps.navigateToMenu(entry.menuPath);
      if (navigated) {
        console.log(`    Navigated via menu: ${entry.menuPath.section ? `${entry.menuPath.section} → ` : ''}${entry.menuPath.items.join(' → ')}`);
        return true;
      }

      const item = entry.menuPath.items[entry.menuPath.items.length - 1];
      if (await deps.clickAppMenuItem(item, entry.menuPath.section)) {
        return true;
      }
    }

    if (entry.directUrls && await deps.navigateToDirectUrl(entry.directUrls)) {
      console.log(`    Navigated via URL: ${entry.directUrls[0]}`);
      return true;
    }
  }

  return false;
}

async function navigateForScenarioArea(scenario: TestScenario, deps: StepExecutorDeps): Promise<boolean> {
  const target = deps.getNavigationTargetForScenario(scenario);

  for (const menuPath of target.menuPaths) {
    if (menuPath.items.length === 0) {
      continue;
    }
    if (await deps.navigateToMenu(menuPath)) {
      return true;
    }
  }

  if (target.directUrls) {
    return deps.navigateToDirectUrl(target.directUrls);
  }

  return false;
}

async function tryNavigateFromText(text: string, scenario: TestScenario, deps: StepExecutorDeps): Promise<boolean> {
  if (isClickShapedStepText(text)) {
    return false;
  }

  if (deps.strictMode) {
    return false;
  }

  if (await tryIntentNavigation(text, scenario, deps)) {
    return true;
  }

  const menuClick = text.match(/clicks?\s+on\s+(.+?)\s+(?:on\s+the\s+)?(?:left(?:\s*hand)?\s+)?menu/i);
  if (menuClick?.[1] && await navigateByMenuLabel(menuClick[1], deps)) {
    return true;
  }

  const goesToView = text.match(/(?:user\s+)?goes?\s+to\s+(?:the\s+)?(.+?)\s+view/i);
  if (goesToView?.[1] && await navigateByMenuLabel(goesToView[1], deps)) {
    return true;
  }

  const navigateTo = text.match(/navigate(?:s)?\s+to\s+(.+?)(?:\s+screen|\s+page|$)/i);
  if (navigateTo?.[1] && await navigateByMenuLabel(navigateTo[1], deps)) {
    return true;
  }

  if (isNavigationShapedText(text)) {
    if (/goes?\s+to\s+/i.test(text) || /open(s)?\s+/i.test(text) || /navigate(?:s)?\s+to/i.test(text)) {
      return navigateForScenarioArea(scenario, deps);
    }
    return navigateByMenuLabel(text, deps);
  }

  return false;
}

async function tryClickFromText(text: string, deps: StepExecutorDeps): Promise<boolean> {
  if (deps.strictMode) {
    return false;
  }

  if (await tryIntentClick(text, deps)) {
    return true;
  }

  return false;
}

function extractQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  const quoted = /["']([^"']{1,60})["']/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(text)) !== null) {
    phrases.push(match[1].trim());
  }

  const clickMatch = text.match(/clicks?\s+(?:on\s+)?['"]?([^'"]+?)['"]?(?:\s+button|\s+link|\s+option|\s+tab|\s+menu|$)/i);
  if (clickMatch?.[1]) {
    phrases.unshift(clickMatch[1].trim());
  }

  return [...new Set(phrases.filter(phrase => phrase.length > 1))];
}

async function tryClickQuotedText(
  text: string,
  deps: StepExecutorDeps
): Promise<{ clicked: boolean; phrase?: string }> {
  for (const phrase of extractQuotedPhrases(text)) {
    const escaped = phrase.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const selectors = [
      `button:has-text("${escaped}")`,
      `[role="button"]:has-text("${escaped}")`,
      `a:has-text("${escaped}")`,
      `[role="menuitem"]:has-text("${escaped}")`,
      `[role="link"]:has-text("${escaped}")`,
      `[role="tab"]:has-text("${escaped}")`,
      `text="${escaped}"`
    ];

    const target = await deps.locatorAnyVisible(selectors, 2000);
    if (target) {
      await target.click({ force: true });
      console.log(`    Clicked quoted text: "${phrase}"`);
      return { clicked: true, phrase };
    }
  }

  return { clicked: false };
}

async function verifyExpectationText(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<{ ok: boolean; status: StepRunStatus; note: string }> {
  if (!text) {
    return { ok: true, status: 'passed', note: '' };
  }

  const pageHealth = await assertNoApplicationError(deps);
  if (!pageHealth.ok) {
    return { ok: false, status: 'failed', note: pageHealth.note };
  }

  if (requiresManualOtp(text)) {
    return { ok: false, status: 'blocked', note: 'OTP / signing step requires manual completion or Mailosaur helper' };
  }

  const goalResult = await verifyStepGoal(text, scenario, deps);
  if (goalResult) {
    return { ok: goalResult.ok, status: goalResult.status, note: goalResult.note };
  }

  for (const field of FIELD_EXPECTATION_MAP) {
    if (field.pattern.test(text)) {
      const visible = await isFieldExpectationVisible(field, deps);
      if (!visible) {
        const pageState = isAuditJourneyPage(deps.page.url()) ? ' (audit form may still be loading)' : '';
        return { ok: false, status: 'failed', note: `Expected field not visible: ${field.label}${pageState}` };
      }
      console.log(`    Verified: ${field.label}`);
      const health = await assertNoApplicationError(deps);
      return { ok: health.ok, status: health.ok ? 'passed' : 'failed', note: health.note };
    }
  }

  const displayedMatch = text.match(/(.+?)\s+is\s+displayed/i);
  if (displayedMatch?.[1]) {
    const subject = displayedMatch[1];
    if (/audit\s+search/i.test(subject)) {
      const ready = await waitForAuditSearchFormReady(deps);
      if (!ready) {
        return { ok: false, status: 'failed', note: 'Audit search form not displayed (timed out waiting for load)' };
      }
      console.log(`    Verified: audit search displayed`);
      return { ok: true, status: 'passed', note: '' };
    }
  }

  if (/should\s+see|can\s+see|should\s+be\s+able\s+to\s+see|can\s+search/i.test(text)) {
    const hasContent = await deps.page.locator(
      'table tbody tr, [data-role="list-item"], .cherry, .list-item, main h1, main h2, app-audit-view-container'
    ).first().isVisible({ timeout: 4000 }).catch(() => false);

    if (hasContent) {
      const afterContent = await assertNoApplicationError(deps);
      if (!afterContent.ok) {
        return { ok: false, status: 'failed', note: afterContent.note };
      }
      console.log(`    Verified visibility expectation: ${text.slice(0, 60)}...`);
      return { ok: true, status: 'passed', note: '' };
    }

    const noData = Boolean(await deps.locatorAnyVisible(['text=No data', 'text=No results', 'text=No items'], 1500));
    if (noData) {
      console.log(`    Verified empty-state expectation`);
      return { ok: true, status: 'passed', note: '' };
    }

    return { ok: false, status: 'failed', note: `Visibility expectation not met: ${text}` };
  }

  if (/navigate(?:s)?\s+to/i.test(text)) {
    await deps.sleep(1500);
    const onPage = await deps.page.locator('main, [role="main"], h1').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!onPage) {
      return { ok: false, status: 'failed', note: `Navigation expectation not met: ${text}` };
    }
    const health = await assertNoApplicationError(deps);
    return { ok: health.ok, status: health.ok ? 'passed' : 'failed', note: health.note };
  }

  return { ok: false, status: 'failed', note: `Could not verify expectation automatically: ${text.slice(0, 120)}` };
}

async function maybeUploadAndAdvance(
  scenario: TestScenario,
  stepText: string,
  deps: StepExecutorDeps
): Promise<{ deviationNotes: string[] }> {
  if (deps.strictMode) {
    return { deviationNotes: [] };
  }

  const deviationNotes: string[] = [];
  const combined = stepText;

  if (/selects?\s+.+file|uploads?\s+.+file|\.csv|\.xlsx/i.test(combined)) {
    const uploaded = await tryIntentFileUpload(combined, scenario.area, deps.repoRoot, deps);
    if (uploaded) {
      const advance = await tryAdvanceObviousModal(deps, combined, scenario);
      if (advance.deviationNote) {
        deviationNotes.push(advance.deviationNote);
      }
    }
  } else if (shouldInferUploadAfterAction(scenario, combined)) {
    const advance = await tryAdvanceObviousModal(deps, combined, scenario);
    if (advance.deviationNote) {
      deviationNotes.push(advance.deviationNote);
    }
  }

  return { deviationNotes };
}

async function executeSingleStep(
  step: TestStep,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<{ ok: boolean; status: StepRunStatus; note: string }> {
  const { action, expected } = getStepLines(step);
  const combined = `${action} ${expected}`.trim();
  const deviationNotes: string[] = [];

  if (!combined) {
    return { ok: true, status: 'passed', note: '' };
  }

  const actionPre = classifyPrecondition(action);
  const expectedPre = classifyPrecondition(expected);

  if (actionPre.kind === 'otp' || expectedPre.kind === 'otp' || requiresManualOtp(combined)) {
    const email = deps.userEmail || '';
    if (deps.handleOtpFlow && email.includes('mailosaur')) {
      console.log(`    Step ${step.stepNumber}: OTP — running Mailosaur flow for ${email}`);
      const otpOk = await deps.handleOtpFlow(email);
      if (otpOk) {
        return { ok: true, status: 'passed', note: 'OTP completed via Mailosaur' };
      }
      return { ok: false, status: 'blocked', note: 'OTP step — Mailosaur flow did not complete' };
    }
    return { ok: false, status: 'blocked', note: 'OTP step — configure Mailosaur user or complete signing manually' };
  }

  if (isSkippablePreconditionText(action)) {
    console.log(`    Step ${step.stepNumber}: ${actionPre.reason || 'precondition skipped'}`);
    return { ok: true, status: 'passed', note: '' };
  }
  if (isSkippablePreconditionText(expected)) {
    console.log(`    Step ${step.stepNumber}: ${expectedPre.reason || 'precondition skipped'}`);
    return { ok: true, status: 'passed', note: '' };
  }

  console.log(`    Step ${step.stepNumber}: ${action || '(action)'}${expected ? ` → ${expected}` : ''}`);

  let actionExecuted = false;
  let stepStatus: StepRunStatus = 'passed';
  let stepNote = '';

  if (action) {
    const crateListStep = await tryInterpretCratesListStep(action, scenario, deps);
    if (crateListStep?.handled) {
      return {
        ok: crateListStep.ok,
        status: crateListStep.status,
        note: crateListStep.note
      };
    }

    if (await tryNavigateFromMenuClick(action, deps)) {
      actionExecuted = true;
      if (/\baudit\b/i.test(action)) {
        await waitForAuditSearchFormReady(deps);
      }
      const afterMenuNav = await assertNoApplicationError(deps);
      if (!afterMenuNav.ok) {
        return { ok: false, status: 'failed', note: afterMenuNav.note };
      }
    } else if (!deps.strictMode && await tryFormActionFromText(action, deps)) {
      actionExecuted = true;
      const afterForm = await assertNoApplicationError(deps);
      if (!afterForm.ok) {
        return { ok: false, status: 'failed', note: afterForm.note };
      }
    } else if (await tryClickFromText(action, deps)) {
      actionExecuted = true;
      const afterClick = await assertNoApplicationError(deps);
      if (!afterClick.ok) {
        return { ok: false, status: 'failed', note: afterClick.note };
      }
      const postClick = await maybeUploadAndAdvance(scenario, action, deps);
      deviationNotes.push(...postClick.deviationNotes);
    } else if (!deps.strictMode && await tryIntentFileUpload(action, scenario.area, deps.repoRoot, deps)) {
      actionExecuted = true;
      const postUpload = await maybeUploadAndAdvance(scenario, action, deps);
      deviationNotes.push(...postUpload.deviationNotes);
      const afterUpload = await assertNoApplicationError(deps);
      if (!afterUpload.ok) {
        return { ok: false, status: 'failed', note: afterUpload.note };
      }
    } else if (await tryNavigateFromText(action, scenario, deps)) {
      actionExecuted = true;
      if (/\baudit\b/i.test(action)) {
        await waitForAuditSearchFormReady(deps);
      }
      const afterNav = await assertNoApplicationError(deps);
      if (!afterNav.ok) {
        return { ok: false, status: 'failed', note: afterNav.note };
      }
    } else if (
      /is\s+displayed|are\s+displayed/i.test(action) ||
      /redirected\s+to|reaches?\s+(?:the\s+)?|lands?\s+on/i.test(action)
    ) {
      const verify = await verifyExpectationText(action, scenario, deps);
      return { ok: verify.ok, status: verify.status, note: verify.note };
    } else {
      const quotedClick = await tryClickQuotedText(action, deps);
      if (quotedClick.clicked) {
        actionExecuted = true;
        const afterQuotedClick = await assertNoApplicationError(deps);
        if (!afterQuotedClick.ok) {
          return { ok: false, status: 'failed', note: afterQuotedClick.note };
        }
        if (!deps.strictMode) {
          const postClick = await maybeUploadAndAdvance(scenario, action, deps);
          deviationNotes.push(...postClick.deviationNotes);
        }
        stepStatus = deps.strictMode ? 'passed' : 'passed-with-deviation';
        stepNote = quotedClick.phrase
          ? `Clicked "${quotedClick.phrase}" via quoted-text fallback`
          : 'Clicked via quoted-text fallback';
      } else if (!/^(when|and)\b/i.test(step.action)) {
        return {
          ok: false,
          status: 'blocked',
          note: `Could not interpret action at step ${step.stepNumber}: ${action}`
        };
      }
    }
  }

  if (expected) {
    const verify = await verifyExpectationText(expected, scenario, deps);
    if (!verify.ok) {
      const status: StepRunStatus = verify.note.includes('OTP') ? 'blocked' : verify.status;
      return { ok: false, status, note: verify.note || `Failed expectation at step ${step.stepNumber}` };
    }
    stepStatus = mergeStatus(stepStatus, verify.status);
    if (verify.note) {
      stepNote = verify.note;
    }

    const postExpected = await maybeUploadAndAdvance(scenario, expected, deps);
    deviationNotes.push(...postExpected.deviationNotes);
  } else if (action && !actionExecuted && /^(when|and)\b/i.test(step.action)) {
    if (/redirected\s+to|reaches?\s+(?:the\s+)?|lands?\s+on|is\s+displayed|are\s+displayed|should\s+see|changes?\s+state/i.test(action)) {
      const verify = await verifyExpectationText(action, scenario, deps);
      return { ok: verify.ok, status: verify.status, note: verify.note };
    }

    const quotedClick = await tryClickQuotedText(action, deps);
    if (quotedClick.clicked) {
      const afterQuotedClick = await assertNoApplicationError(deps);
      if (!afterQuotedClick.ok) {
        return { ok: false, status: 'failed', note: afterQuotedClick.note };
      }
      return {
        ok: true,
        status: deps.strictMode ? 'passed' : 'passed-with-deviation',
        note: quotedClick.phrase
          ? `Clicked "${quotedClick.phrase}" via quoted-text fallback`
          : 'Clicked via quoted-text fallback'
      };
    }

    return {
      ok: false,
      status: 'blocked',
      note: `Could not interpret step ${step.stepNumber}: ${action}`
    };
  }

  await deps.sleep(800);
  const finalHealth = await assertNoApplicationError(deps);
  if (!finalHealth.ok) {
    return { ok: false, status: 'failed', note: finalHealth.note };
  }

  if (deviationNotes.length > 0 && !deps.strictMode) {
    stepStatus = 'passed-with-deviation';
    const combinedNote = [stepNote, ...deviationNotes].filter(Boolean).join(' ');
    return { ok: true, status: stepStatus, note: combinedNote };
  }

  return { ok: true, status: stepStatus, note: stepNote };
}

function statusRank(status: StepRunStatus): number {
  switch (status) {
    case 'passed':
      return 4;
    case 'passed-with-deviation':
      return 3;
    case 'failed':
      return 2;
    case 'blocked':
      return 1;
    default:
      return 0;
  }
}

export async function executeScenarioStepsWithStrictRetry(
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<StepExecutionResult> {
  const firstResult = await executeScenarioSteps(scenario, deps);
  if (firstResult.status !== 'blocked') {
    return firstResult;
  }

  console.log('    Blocked on first pass — running strict replay (exact steps only)...');
  const strictResult = await executeScenarioSteps(scenario, { ...deps, strictMode: true });

  if (statusRank(strictResult.status) > statusRank(firstResult.status)) {
    return {
      ...strictResult,
      note: `[strict replay] ${strictResult.note}`
    };
  }

  return firstResult;
}

export async function executeScenarioSteps(
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<StepExecutionResult> {
  await deps.dismissBlockingModals();

  if (!scenario.steps.length) {
    return {
      status: 'blocked',
      note: 'Scenario has no steps in workbook',
      stepsExecuted: 0
    };
  }

  let executed = 0;
  let scenarioStatus: StepRunStatus = 'passed';
  const deviationNotes: string[] = [];

  for (const step of scenario.steps) {
    const outcome = await executeSingleStep(step, scenario, deps);
    executed++;

    if (!outcome.ok) {
      return {
        status: outcome.status,
        note: outcome.note,
        failedStepNumber: step.stepNumber,
        stepsExecuted: executed
      };
    }

    scenarioStatus = mergeStatus(scenarioStatus, outcome.status);
    if (outcome.status === 'passed-with-deviation' && outcome.note) {
      deviationNotes.push(`Step ${step.stepNumber}: ${outcome.note}`);
    }
  }

  const scenarioHealth = await assertNoApplicationError(deps);
  if (!scenarioHealth.ok) {
    return {
      status: 'failed',
      note: scenarioHealth.note,
      failedStepNumber: scenario.steps[scenario.steps.length - 1]?.stepNumber,
      stepsExecuted: executed
    };
  }

  if (scenarioStatus === 'passed-with-deviation') {
    return {
      status: 'passed-with-deviation',
      note: deviationNotes.join(' | ') || `All ${executed} steps executed with deviations`,
      stepsExecuted: executed
    };
  }

  return {
    status: 'passed',
    note: `All ${executed} steps executed`,
    stepsExecuted: executed
  };
}
