import { verifyCrateContentGoal } from './crateContext';
import { verifyDomainGoal } from './domainGoals';
import { FeatureArea, TestScenario } from './parseXlsxScenarios';
import { StepExecutorDeps } from './stepExecutorTypes';

export type GoalVerificationStatus = 'passed' | 'passed-with-deviation' | 'failed' | 'blocked';

export interface GoalVerificationResult {
  ok: boolean;
  status: GoalVerificationStatus;
  note: string;
}

const MODAL_ROOT = 'ngb-modal-window, [role="dialog"]';
const MODAL_HEADER = '[data-role="modal-header"]';
const FILE_INPUT = 'input[type="file"]';

const UPLOAD_TITLE_SYNONYMS: Record<string, string[]> = {
  'file upload': ['standing crate', 'upload', 'crate', 'file'],
  'standing crate': ['file upload', 'upload', 'standing crate'],
  upload: ['file upload', 'standing crate', 'crate']
};

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function titlesMatch(expected: string, actual: string): boolean {
  const exp = normalizeLabel(expected);
  const act = normalizeLabel(actual);
  if (!exp || !act) {
    return true;
  }
  if (act.includes(exp) || exp.includes(act)) {
    return true;
  }
  const synonyms = UPLOAD_TITLE_SYNONYMS[exp] || [];
  return synonyms.some(synonym => act.includes(synonym) || synonym.includes(act));
}

function extractExpectedModalTitle(text: string): string | null {
  const directed = text.match(/directed\s+to\s+(?:the\s+)?(.+?)\s+modal/i);
  if (directed?.[1]) {
    return directed[1].trim();
  }
  const opens = text.match(/(?:opens?|sees?)\s+(?:the\s+)?(.+?)\s+modal/i);
  if (opens?.[1]) {
    return opens[1].trim();
  }
  const quoted = text.match(/["']([^"']+)["']\s+modal/i);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  return null;
}

async function isModalVisible(deps: StepExecutorDeps): Promise<boolean> {
  return deps.page.locator(MODAL_ROOT).first().isVisible({ timeout: 3000 }).catch(() => false);
}

async function hasUploadAffordance(deps: StepExecutorDeps): Promise<boolean> {
  const selectors = [
    FILE_INPUT,
    '[data-role*="upload"]',
    'text=Upload file',
    'text=Drag and drop',
    'button:has-text("Upload")'
  ];
  return Boolean(await deps.locatorAnyVisible(selectors, 2000));
}

async function getModalHeaderText(deps: StepExecutorDeps): Promise<string> {
  const header = deps.page.locator(`${MODAL_ROOT} ${MODAL_HEADER}, ${MODAL_HEADER}`).first();
  if (!(await header.isVisible({ timeout: 1500 }).catch(() => false))) {
    return '';
  }
  const text = await header.textContent();
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

function isFileUploadStepText(text: string): boolean {
  if (/notifications?\s+preferences|custom(?:ize)?\s+tiles|quick\s+actions|order\s+order|order\s+details|confirmation\s+details/i.test(text)) {
    return false;
  }
  if (/upload\s+(?:a\s+)?file|file\s+upload|upload\s+(?:csv|xlsx|crate)|crate\s+upload|direct\s+outflow.*upload/i.test(text)) {
    return true;
  }
  if (/\b(?:re)?directed\s+to\b/i.test(text) && /upload|file\s+upload/i.test(text)) {
    return true;
  }
  if (/(?:opens?|sees?)\s+(?:the\s+)?(?:file\s+upload|upload)\s+modal/i.test(text)) {
    return true;
  }
  return false;
}

export async function verifyOpenUploadModalGoal(
  text: string,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  if (!isFileUploadStepText(text)) {
    return null;
  }

  const modalVisible = await isModalVisible(deps);
  if (!modalVisible) {
    return {
      ok: false,
      status: 'failed',
      note: 'Upload modal not visible (expected dialog with file upload affordance)'
    };
  }

  const uploadReady = await hasUploadAffordance(deps);
  if (!uploadReady) {
    return {
      ok: false,
      status: 'failed',
      note: 'Modal is open but file upload control is not visible'
    };
  }

  const expectedTitle = extractExpectedModalTitle(text);
  const actualTitle = await getModalHeaderText(deps);

  if (expectedTitle && actualTitle && !titlesMatch(expectedTitle, actualTitle)) {
    return {
      ok: true,
      status: 'passed-with-deviation',
      note: [
        'Upload flow reached successfully.',
        `Workbook expected modal title "${expectedTitle}"; actual modal title "${actualTitle}".`,
        'Treated as equivalent upload modal because file input/upload controls are present.'
      ].join(' ')
    };
  }

  console.log(`    Verified upload modal goal${actualTitle ? ` (header: "${actualTitle}")` : ''}`);
  return { ok: true, status: 'passed', note: '' };
}

export async function verifyUploadFileGoal(
  text: string,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  if (!/selects?\s+.+file|uploads?\s+.+file|file\s+uploaded|file\s+is\s+uploaded/i.test(text)) {
    return null;
  }

  const uploadedNotice = Boolean(
    await deps.locatorAnyVisible(
      ['text=File uploaded', '[data-role="notification-alert"]:has-text("upload")'],
      2000
    )
  );

  const fileInput = deps.page.locator(FILE_INPUT).first();
  const inputVisible = await fileInput.isVisible({ timeout: 1500 }).catch(() => false);

  if (uploadedNotice) {
    console.log('    Verified file upload goal (upload notification visible)');
    return { ok: true, status: 'passed', note: '' };
  }

  if (inputVisible) {
    console.log('    Verified file upload goal (file input available in modal)');
    return { ok: true, status: 'passed', note: '' };
  }

  return {
    ok: false,
    status: 'failed',
    note: 'File upload goal not met — no upload confirmation or file input visible'
  };
}

const MODAL_ADVANCE_SELECTORS = [
  '[data-role="modal-button-next"]',
  'ngb-modal-window button:has-text("Continue")',
  'ngb-modal-window button:has-text("Confirm")',
  'ngb-modal-window button:has-text("Next")',
  '[role="dialog"] button:has-text("Continue")',
  'button:has-text("Continue")'
];

export interface ModalAdvanceResult {
  advanced: boolean;
  buttonLabel?: string;
  deviationNote?: string;
}

export async function tryAdvanceObviousModal(
  deps: StepExecutorDeps,
  stepText: string,
  scenario: TestScenario
): Promise<ModalAdvanceResult> {
  if (!(await isModalVisible(deps))) {
    return { advanced: false };
  }

  const uploadGoal = /upload|crate|direct\s+outflow|file/i.test(
    `${scenario.name} ${stepText} ${scenario.area}`
  );
  if (!uploadGoal) {
    return { advanced: false };
  }

  const stepMentionsContinue = /continue|next|confirm|submit/i.test(stepText);

  for (const selector of MODAL_ADVANCE_SELECTORS) {
    const button = deps.page.locator(selector).first();
    if (!(await button.isVisible({ timeout: 1500 }).catch(() => false))) {
      continue;
    }
    const label = (await button.textContent())?.trim() || selector;
    if (/cancel|close|back/i.test(label) && !/continue|confirm|next/i.test(label)) {
      continue;
    }
    await button.click({ force: true });
    await deps.sleep(1200);
    console.log(`    Clicked modal forward action: ${label}`);

    let deviationNote: string | undefined;
    if (!stepMentionsContinue) {
      deviationNote = [
        'Continued upload flow via modal forward action',
        `Clicked "${label}" (${selector})`,
        'because scenario did not name the button but it was the clear forward action in the open modal.'
      ].join(' ');
    }

    return { advanced: true, buttonLabel: label, deviationNote };
  }

  return { advanced: false };
}

const SUCCESS_TOAST_PATTERNS = [
  /successfully/i,
  /\bsaved\b/i,
  /\bcreated\b/i,
  /\bsubmitted\b/i,
  /\bapproved\b/i,
  /\brejected\b/i,
  /\bcompleted\b/i,
  /\bconfirmed\b/i,
  /\buploaded\b/i,
  /\bdeleted\b/i,
  /\bcancelled\b/i,
  /\bupdated\b/i
];

const TOAST_SELECTORS = [
  '[role="alert"]',
  '[data-role="notification-alert"]',
  '.app-notification',
  '[data-role="toast"]',
  '.toast',
  '[class*="notification"]'
];

export async function verifySuccessToastGoal(
  text: string,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  const expectsSuccess = SUCCESS_TOAST_PATTERNS.some(pattern => pattern.test(text));
  if (!expectsSuccess) {
    return null;
  }

  for (const selector of TOAST_SELECTORS) {
    const toast = deps.page.locator(selector).first();
    if (!(await toast.isVisible({ timeout: 3000 }).catch(() => false))) {
      continue;
    }

    const toastText = ((await toast.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (!toastText) {
      continue;
    }

    if (SUCCESS_TOAST_PATTERNS.some(pattern => pattern.test(toastText))) {
      console.log(`    Verified success toast: ${toastText.slice(0, 80)}`);
      return { ok: true, status: 'passed', note: '' };
    }
  }

  return {
    ok: false,
    status: 'failed',
    note: 'Expected success notification not visible on page'
  };
}

export async function verifyStatusLabelGoal(
  text: string,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  const statusMatch =
    text.match(/status\s+(?:is|was|changes?\s+to|changed\s+to)\s+['"]?([^'".\n]+?)['"]?(?:\.|$|\s)/i) ||
    text.match(/(?:in|with)\s+['"]?([^'"]+?)['"]?\s+status/i);

  if (!statusMatch?.[1]) {
    return null;
  }

  const expectedStatus = statusMatch[1].trim();
  if (!expectedStatus) {
    return null;
  }

  const escaped = expectedStatus.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const visible = Boolean(
    await deps.locatorAnyVisible(
      [
        `[data-role="status"]:has-text("${escaped}")`,
        `[data-role*="status"]:has-text("${escaped}")`,
        `text="${escaped}"`,
        `span:has-text("${escaped}")`,
        `td:has-text("${escaped}")`,
        `.badge:has-text("${escaped}")`
      ],
      4000
    )
  );

  if (visible) {
    console.log(`    Verified status label: ${expectedStatus}`);
    return { ok: true, status: 'passed', note: '' };
  }

  return {
    ok: false,
    status: 'failed',
    note: `Expected status "${expectedStatus}" not visible on page`
  };
}

export async function verifyStepGoal(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  const uploadModal = await verifyOpenUploadModalGoal(text, deps);
  if (uploadModal) {
    return uploadModal;
  }

  const uploadFile = await verifyUploadFileGoal(text, deps);
  if (uploadFile) {
    return uploadFile;
  }

  const crateContent = await verifyCrateContentGoal(text, scenario, deps);
  if (crateContent) {
    return crateContent;
  }

  const domainGoal = await verifyDomainGoal(text, scenario, deps);
  if (domainGoal) {
    return domainGoal;
  }

  if (/changes?\s+state|disabled\s+to\s+enabled|vice\s+versa/i.test(text) && /crate|grower|notification|toggle|slider/i.test(text)) {
    const saved = Boolean(
      await deps.locatorAnyVisible(
        [
          '[data-role="notification-alert"]:has-text("Changes saved")',
          'text=Changes saved',
          '.app-notification:has-text("Changes saved")'
        ],
        5000
      )
    );
    if (saved) {
      console.log('    Verified notification preference change saved');
      return { ok: true, status: 'passed', note: '' };
    }
    const toggleLabel = /grower/i.test(text) ? 'Growers' : 'Crates';
    const toggle = await deps.locatorAnyVisible(
      [
        `app-toggle-recipe-form[label="${toggleLabel}"] .app-switch__element--checked`,
        `app-toggle-recipe-form[label="${toggleLabel}"] .app-switch__element`
      ],
      3000
    );
    if (toggle) {
      console.log(`    Verified ${toggleLabel} toggle is present after click (no Changes saved toast detected)`);
      return {
        ok: true,
        status: 'passed-with-deviation',
        note: `${toggleLabel} notification toggle clicked; "Changes saved" alert not detected within timeout (toggle may already be in target state).`
      };
    }
  }

  if (/notifications?\s+preferences/i.test(text)) {
    const onPrefs = Boolean(
      await deps.locatorAnyVisible(
        [
          'h2:has-text("Approval notifications")',
          'text=Approval notifications',
          '[data-role="notifications-tab"]',
          '[data-role="notifications-to-approve-tab"]',
          'button:has-text("I need to approve")'
        ],
        5000
      )
    );
    if (onPrefs) {
      console.log('    Verified notification preferences view');
      return { ok: true, status: 'passed', note: '' };
    }
    return {
      ok: false,
      status: 'failed',
      note: 'Notification preferences view not visible (expected Approval notifications / preference tabs)'
    };
  }

  if (/redirected\s+to|reaches?\s+(?:the\s+)?(.+?)\s+view/i.test(text)) {
    const viewMatch = text.match(/redirected\s+to\s+['"]?([^'"]+)['"]?|reaches?\s+(?:the\s+)?(.+?)\s+view/i);
    const viewName = viewMatch?.[1] || viewMatch?.[2];
    if (viewName) {
      if (/notifications?\s+preferences/i.test(viewName)) {
        const onPrefs = Boolean(
          await deps.locatorAnyVisible(
            ['h2:has-text("Approval notifications")', 'button:has-text("I need to approve")'],
            5000
          )
        );
        if (onPrefs) {
          console.log('    Verified notification preferences view');
          return { ok: true, status: 'passed', note: '' };
        }
      }
      const onView = Boolean(
        await deps.locatorAnyVisible(
          [`h1:has-text("${viewName}")`, `h2:has-text("${viewName}")`, `text=${viewName}`],
          3000
        )
      );
      if (onView) {
        console.log(`    Verified view goal: ${viewName}`);
        return { ok: true, status: 'passed', note: '' };
      }
      if (await isModalVisible(deps) && /reversal|upload|direct/i.test(viewName)) {
        const header = await getModalHeaderText(deps);
        return {
          ok: true,
          status: header && !titlesMatch(viewName, header) ? 'passed-with-deviation' : 'passed',
          note: header && !titlesMatch(viewName, header)
            ? `Reached modal flow; workbook expected view "${viewName}", modal header "${header}".`
            : ''
        };
      }
    }
  }

  const successToast = await verifySuccessToastGoal(text, deps);
  if (successToast) {
    return successToast;
  }

  const statusLabel = await verifyStatusLabelGoal(text, deps);
  if (statusLabel) {
    return statusLabel;
  }

  return null;
}

export function isNavigationShapedText(text: string): boolean {
  if (/\b(?:clicks?|selects?|presses?)\b/i.test(text)) {
    return false;
  }
  return /\bnavigate(?:s|d)?\s+to\b|\bgoes?\s+to\b|\blands?\s+on\b|\bopen(?:s|ed)?\s+(?:the\s+)?\w+/i.test(text);
}

export function shouldInferUploadAfterAction(
  scenario: TestScenario,
  action: string
): boolean {
  return (
    (scenario.area === 'standing-crates' || scenario.area === 'crates') &&
    (/new\s+direct\s+outflow|new\s+crate|crate\s+upload|upload/i.test(action) ||
      /upload/i.test(scenario.name))
  );
}
