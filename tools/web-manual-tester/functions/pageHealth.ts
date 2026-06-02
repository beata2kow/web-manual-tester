/**
 * Detects application-level error UI (false-positive guard).
 * Used by the step runner and documented in web-manual-tester.prompt.md for Copilot runs.
 */

export const APPLICATION_ERROR_PHRASES = [
  'Unexpected error',
  'Something went wrong',
  "Page couldn't load",
  'Page could not load',
  'Unknown error',
  'Unable to load',
  'Failed to load',
  'An error occurred',
  'Error loading',
  'We are sorry',
  'Please try again later'
] as const;

export const APPLICATION_ERROR_PATTERNS: RegExp[] = [
  /unexpected\s+error/i,
  /something\s+went\s+wrong/i,
  /page\s+couldn'?t\s+load/i,
  /page\s+could\s+not\s+load/i,
  /unknown\s+error/i,
  /unable\s+to\s+load/i,
  /failed\s+to\s+load/i,
  /an\s+error\s+occurred/i,
  /error\s+loading/i,
  /please\s+try\s+again\s+later/i
];

interface PageHealthLocator {
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  textContent(): Promise<string | null>;
}

interface PageHealthPage {
  locator(selector: string): {
    first(): PageHealthLocator;
    count(): Promise<number>;
    nth(index: number): { first(): PageHealthLocator };
  };
}

const ERROR_CONTAINER_SELECTORS = [
  'main',
  '[role="main"]',
  'app-root',
  '.app-layout__main',
  '[data-role="error-state"]',
  '.app-error-state',
  'app-empty-state-ui'
];

const ERROR_ALERT_SELECTORS = [
  '[data-role="notification-alert"]',
  '[role="alert"]',
  '.alert-danger',
  '.app-state-container'
];

function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function messageMatchesErrorPattern(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return APPLICATION_ERROR_PATTERNS.some(pattern => pattern.test(normalized));
}

async function firstVisibleText(
  page: PageHealthPage,
  selector: string,
  timeout = 400
): Promise<string | null> {
  const target = page.locator(selector).first();
  if (!(await target.isVisible({ timeout }).catch(() => false))) {
    return null;
  }
  const text = await target.textContent();
  return text ? normalizeMessage(text) : null;
}

async function scanLocatorGroup(page: PageHealthPage, selectors: string[]): Promise<string | null> {
  for (const container of selectors) {
    for (const pattern of APPLICATION_ERROR_PATTERNS) {
      const selector = `${container} >> text=/${pattern.source}/i`;
      const message = await firstVisibleText(page, selector, 350);
      if (message && messageMatchesErrorPattern(message)) {
        return message;
      }
    }
  }
  return null;
}

async function scanAlertElements(page: PageHealthPage): Promise<string | null> {
  for (const alertSelector of ERROR_ALERT_SELECTORS) {
    const alerts = page.locator(alertSelector);
    const count = await alerts.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 6); index++) {
      const alert = alerts.nth(index).first();
      if (!(await alert.isVisible({ timeout: 300 }).catch(() => false))) {
        continue;
      }

      const text = await alert.textContent();
      if (!text) {
        continue;
      }

      const normalized = normalizeMessage(text);
      if (messageMatchesErrorPattern(normalized)) {
        return normalized;
      }
    }
  }

  return null;
}

/**
 * Returns whether the current page shows a user-visible application error.
 */
export async function detectPageApplicationError(
  page: PageHealthPage
): Promise<{ hasError: boolean; message: string }> {
  const fromContainers = await scanLocatorGroup(page, ERROR_CONTAINER_SELECTORS);
  if (fromContainers) {
    return { hasError: true, message: fromContainers };
  }

  const fromAlerts = await scanAlertElements(page);
  if (fromAlerts) {
    return { hasError: true, message: fromAlerts };
  }

  for (const phrase of APPLICATION_ERROR_PHRASES) {
    const escaped = phrase.replace(/'/g, "\\'");
    const message = await firstVisibleText(page, `text='${escaped}'`, 250);
    if (message) {
      return { hasError: true, message };
    }
  }

  return { hasError: false, message: '' };
}

export function formatApplicationErrorNote(message: string): string {
  return `Application error on page: "${message}"`;
}
