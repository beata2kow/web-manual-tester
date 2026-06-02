import { FeatureArea, TestScenario } from './parseXlsxScenarios';
import { resolveUploadFixturePath } from './uploadFixtures';
import { MenuPath, StepExecutorDeps } from './stepExecutorTypes';

export interface NavigationIntent {
  menuLabels: string[];
  section?: string;
  directUrls?: string[];
}

const NAVIGATION_INTENTS: Array<{ patterns: RegExp[]; intent: NavigationIntent }> = [
  {
    patterns: [/products?/i, /product\s+catalog/i, /sub\s+categor/i, /explore\s+product/i, /apply\s+for\s+product/i],
    intent: { menuLabels: ['Apply for products', 'Products', 'Explore products'], section: 'Products', directUrls: ['/products', '/explore-products'] }
  },
  {
    patterns: [/manage\s+templates?/i, /order\s+templates?/i, /saved\s+order\s+templates?/i],
    intent: { menuLabels: ['Templates'], section: 'Move produce', directUrls: ['/templates/deliveries'] }
  },
  {
    patterns: [/grower\s+manager/i, /manage\s+growers?/i],
    intent: { menuLabels: ['Growers'], section: 'Move produce', directUrls: ['/self-service/manage-growers'] }
  },
  {
    patterns: [/dashboard/i],
    intent: { menuLabels: [], directUrls: ['/dashboard'] }
  },
  {
    patterns: [/direct\s+outflow/i],
    intent: { menuLabels: ['Standing crates'], section: 'Move produce' }
  },
  {
    patterns: [/login\s*&?\s*security/i, /login\s+and\s+security/i],
    intent: { menuLabels: ['My profile'], section: 'Personal', directUrls: ['/self-service/profile/login-security/'] }
  },
  {
    patterns: [/my\s+profile/i, /profile\s+tab/i],
    intent: { menuLabels: ['My profile', 'Profile'], section: 'Personal', directUrls: ['/self-service/profile/profile'] }
  },
  {
    patterns: [/manage\s+notifications/i, /notification\s+settings?/i],
    intent: { menuLabels: ['My profile'], section: 'Personal' }
  },
  {
    patterns: [/baskets?/i],
    intent: { menuLabels: ['Baskets'], section: 'Baskets & cherries' }
  },
  {
    patterns: [/cherries?/i, /spending\s+limits?/i],
    intent: { menuLabels: ['Cherries'], section: 'Baskets & cherries', directUrls: ['/self-service/manage-cherries'] }
  },
  {
    patterns: [/crates?/i],
    intent: { menuLabels: ['Crates'], section: 'Move produce' }
  },
  {
    patterns: [/orders?/i, /deliveries?/i],
    intent: { menuLabels: ['Orders'], section: 'Move produce', directUrls: ['/deliveries'] }
  }
];

function extractQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  const re = /["']([^"']{2,60})["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    phrases.push(match[1].trim());
  }
  return phrases;
}

function extractDestinationPhrase(text: string): string[] {
  const phrases: string[] = [];
  const patterns = [
    /navigate(?:s|d)?\s+to\s+(?:the\s+)?(.+?)(?:\s+page|\s+screen|\s+view|$)/i,
    /goes?\s+to\s+(?:the\s+)?(.+?)(?:\s+view|\s+page|$)/i,
    /lands?\s+on\s+(?:the\s+)?(.+?)(?:\s+page|$)/i,
    /clicks?\s+on\s+(.+?)\s+(?:on\s+the\s+)?(?:left|side)?\s*menu/i,
    /open(?:s|ed)?\s+(?:the\s+)?(.+?)(?:\s+page|\s+view|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      phrases.push(match[1].replace(/\s+tab$/i, '').trim());
    }
  }

  return phrases;
}

function collectIntentsFromText(text: string): NavigationIntent[] {
  const intents: NavigationIntent[] = [];
  const seen = new Set<string>();

  const register = (intent: NavigationIntent) => {
    const key = `${intent.section || ''}:${intent.menuLabels.join('|')}:${intent.directUrls?.join('|') || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      intents.push(intent);
    }
  };

  for (const entry of NAVIGATION_INTENTS) {
    if (entry.patterns.some(pattern => pattern.test(text))) {
      register(entry.intent);
    }
  }

  for (const phrase of [...extractDestinationPhrase(text), ...extractQuotedPhrases(text)]) {
    if (phrase.length < 3) {
      continue;
    }
    register({ menuLabels: [phrase] });
  }

  return intents;
}

async function tryIntent(def: NavigationIntent, deps: StepExecutorDeps): Promise<boolean> {
  if (def.directUrls?.length && await deps.navigateToDirectUrl(def.directUrls)) {
    console.log(`    Navigated via intent URL: ${def.directUrls[0]}`);
    return true;
  }

  for (const label of def.menuLabels) {
    const menuPath: MenuPath = { section: def.section, items: [label] };
    if (menuPath.items.length > 0 && await deps.navigateToMenu(menuPath)) {
      console.log(`    Navigated via intent menu: ${def.section ? `${def.section} → ` : ''}${label}`);
      return true;
    }
    if (await deps.clickAppMenuItem(label, def.section)) {
      console.log(`    Navigated via intent click: ${label}`);
      return true;
    }
  }

  return false;
}

export function isClickShapedStepText(text: string): boolean {
  return /\b(?:clicks?|selects?|presses?)\b/i.test(text);
}

export async function tryIntentNavigation(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<boolean> {
  if (isClickShapedStepText(text)) {
    return false;
  }

  const intents = collectIntentsFromText(text);
  for (const intent of intents) {
    if (await tryIntent(intent, deps)) {
      return true;
    }
  }

  if (/dashboard/i.test(text) && /\/dashboard/i.test(deps.page.url())) {
    console.log('    Already on dashboard');
    return true;
  }

  return false;
}

export async function tryIntentClick(text: string, deps: StepExecutorDeps): Promise<boolean> {
  const clickMatch = text.match(/(?:clicks?|selects?|presses?)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button|\s+link|\s+tab|\s+menu|\s+option|\s+icon|\s+in\s+|\s+for\s+|$)/i);
  if (!clickMatch?.[1]) {
    return false;
  }

  let target = clickMatch[1].trim().replace(/\s+in\s+the\s+.+$/i, '').trim();
  target = target.replace(/^['"]|['"]$/g, '').trim();

  if (/new\s+direct\s+outflow/i.test(target)) {
    const newDd = await deps.locatorAnyVisible(
      [
        '[data-role="heading-button"]',
        'button:has-text("New standing crate")',
        'a:has-text("New standing crate")'
      ],
      3000
    );
    if (newDd) {
      await newDd.click({ force: true });
      await deps.sleep(1200);
      console.log('    Clicked: New standing crate');
      return true;
    }
  }

  if (/new\s+crate|crate\s+upload/i.test(target)) {
    const newCrate = await deps.locatorAnyVisible(
      [
        'button:has-text("New crate")',
        'button:has-text("Crate upload")',
        'text="Crate upload"',
        'button:has-text("Upload")'
      ],
      3000
    );
    if (newCrate) {
      await newCrate.click({ force: true });
      await deps.sleep(1200);
      console.log(`    Clicked: ${target}`);
      return true;
    }
  }

  if (/\bbell\b/i.test(text) || /notification\s+bell/i.test(text)) {
    const bellSelectors = [
      '[data-role="notifications-icon"]',
      'app-notifications-badge',
      'app-notifications-badge button',
      '[data-role="notifications-button"]',
      'button[aria-label*="notification" i]',
      'button[aria-label*="Notification" i]',
      '.app-layout__topbar app-notifications-badge',
      '.app-layout__topbar button:has([class*="notification"])'
    ];
    const bell = await deps.locatorAnyVisible(bellSelectors, 4000);
    if (bell) {
      await bell.click({ force: true });
      await deps.sleep(1200);
      console.log('    Clicked notifications bell');
      return true;
    }
    console.log('    Notifications bell not visible (checked app-notifications-badge, notifications-icon, aria-label)');
  }

  if (/gearbox|cog\s*wheel|settings\s+button|manage\s+notifications/i.test(text)) {
    const settingsSelectors = [
      '[data-role="settings-button"]',
      'button[data-role="settings-button"]',
      'app-notifications-list button[data-role="settings-button"]',
      'button[aria-label*="settings" i]',
      'button[aria-label*="Settings" i]'
    ];
    const settings = await deps.locatorAnyVisible(settingsSelectors, 4000);
    if (settings) {
      await settings.click({ force: true });
      await deps.sleep(1500);
      console.log('    Clicked notification settings (gearbox)');
      return true;
    }
    console.log('    Notification settings button not visible — open bell first');
  }

  if (/i\s+need\s+to\s+approve/i.test(text)) {
    const tab = await deps.locatorAnyVisible(
      ['button:has-text("I need to approve")', '[role="tab"]:has-text("I need to approve")'],
      4000
    );
    if (tab) {
      await tab.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked I need to approve tab');
      return true;
    }
  }

  if (/created\s+by\s+me/i.test(text)) {
    const tab = await deps.locatorAnyVisible(
      ['button:has-text("Created by me")', '[role="tab"]:has-text("Created by me")'],
      4000
    );
    if (tab) {
      await tab.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Created by me tab');
      return true;
    }
  }

  if (/slider|toggle/i.test(text) && /crate/i.test(text)) {
    const crateToggle = await deps.locatorAnyVisible(
      [
        'app-toggle-recipe-form[label="Crates"] .app-switch__element',
        'app-toggle-recipe-form[label="Crates"] button',
        '[data-role="notifications-to-approve-tab"] app-toggle-recipe-form[label="Crates"] .app-switch__element',
        '[data-role="notifications-tab"] app-toggle-recipe-form[label="Crates"] .app-switch__element'
      ],
      4000
    );
    if (crateToggle) {
      await crateToggle.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Crates notification toggle');
      return true;
    }
  }

  if (/quick\s+actions?/i.test(text) || /quick\s+actions?/i.test(target)) {
    const quickActions = await deps.locatorAnyVisible(
      [
        '[data-role="quick-actions"]',
        'button:has-text("Quick actions")',
        '[data-role="quick-action-button"]',
        'app-quick-actions button',
        '.app-quick-actions button'
      ],
      4000
    );
    if (quickActions) {
      await quickActions.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Quick actions');
      return true;
    }
  }

  if (/filter/i.test(target) || /clicks?\s+on\s+['"]?filter['"]?/i.test(text)) {
    const filterBtn = await deps.locatorAnyVisible(
      [
        'button:has-text("Filter")',
        '[data-role="filter-button"]',
        '[data-role="app-filter-button"]',
        'app-filter-button button'
      ],
      4000
    );
    if (filterBtn) {
      await filterBtn.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Filter');
      return true;
    }
  }

  if (/drop\s*down\s+next\s+to\s+['"]?create\s+new|create\s+new['"]?\s+button/i.test(text)) {
    const createNew = await deps.locatorAnyVisible(
      ['button:has-text("Create new")', '[data-role="create-button"]', 'app-dropdown-menu-ui button:has-text("Create")'],
      4000
    );
    if (createNew) {
      await createNew.click({ force: true });
      await deps.sleep(800);
      console.log('    Opened Create new dropdown');
      return true;
    }
  }

  if (/new\s+grower|edit\s+grower|delete\s+grower/i.test(text)) {
    const labelMatch = text.match(/['"]([^'"]+grower[^'"]*)['"]/i);
    const label = labelMatch?.[1] || (target.includes('grower') ? target : '');
    if (label) {
      const btn = await deps.locatorAnyVisible(
        [`button:has-text("${label}")`, `a:has-text("${label}")`, `[data-role*="grower"]:has-text("${label}")`],
        4000
      );
      if (btn) {
        await btn.click({ force: true });
        await deps.sleep(1000);
        console.log(`    Clicked: ${label}`);
        return true;
      }
    }
  }

  if (/manage\s+tab/i.test(target) || /^manage$/i.test(target)) {
    const manageTab = await deps.locatorAnyVisible(
      ['[role="tab"]:has-text("Manage")', 'button:has-text("Manage")', 'a:has-text("Manage")'],
      3000
    );
    if (manageTab) {
      await manageTab.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Manage tab');
      return true;
    }
  }

  if (/spending\s+limits?/i.test(target)) {
    const spending = await deps.locatorAnyVisible(
      ['[role="menuitem"]:has-text("Basket limits")', 'button:has-text("Basket limits")', 'a:has-text("Basket limits")'],
      3000
    );
    if (spending) {
      await spending.click({ force: true });
      await deps.sleep(1000);
      console.log('    Clicked Basket limits');
      return true;
    }
  }

  if (/basket/i.test(target) && /select/i.test(text)) {
    const basketRow = deps.page.locator('table tbody tr a, table tbody tr, [data-role="list-item"] a, [data-role="basket-list-item"]').first();
    if (await basketRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await basketRow.click({ force: true });
      await deps.sleep(1200);
      console.log('    Selected first basket row');
      return true;
    }
  }

  const quoted = target.match(/["']([^"']+)["']/);
  const labels = [quoted?.[1], target]
    .filter((value): value is string => Boolean(value))
    .flatMap(label => label.split(/\s+or\s+/i).map(part => part.trim()))
    .filter(Boolean);

  for (const label of labels) {
    const candidates = [
      `button:has-text("${label}")`,
      `a:has-text("${label}")`,
      `[role="tab"]:has-text("${label}")`,
      `[role="button"]:has-text("${label}")`,
      `[role="menuitem"]:has-text("${label}")`,
      `[aria-label="${label}"]`,
      `text=${label}`
    ];
    const clickable = await deps.locatorAnyVisible(candidates, 2500);
    if (clickable) {
      await clickable.click({ force: true });
      await deps.sleep(1000);
      console.log(`    Clicked: ${label}`);
      return true;
    }

    if (await deps.clickAppMenuItem(label)) {
      return true;
    }
  }

  return false;
}

export async function tryIntentFileUpload(
  text: string,
  area: FeatureArea,
  repoRoot: string | undefined,
  deps: StepExecutorDeps & { uploadFixture?: (filePath: string) => Promise<boolean> }
): Promise<boolean> {
  if (!/selects?\s+.+file|uploads?\s+.+file|\.csv|\.xlsx/i.test(text)) {
    return false;
  }

  if (!repoRoot || !deps.uploadFixture) {
    return false;
  }

  const fixturePath = resolveUploadFixturePath(repoRoot, area, text);
  if (!fixturePath) {
    return false;
  }

  const uploaded = await deps.uploadFixture(fixturePath);
  if (uploaded) {
    console.log(`    Uploaded repo fixture: ${fixturePath}`);
    return true;
  }

  return false;
}
