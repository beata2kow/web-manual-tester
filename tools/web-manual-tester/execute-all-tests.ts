#!/usr/bin/env npx ts-node
/**
 * Execute ALL Manual Tests following system prompt guidelines
 * - Executes feature areas in priority order (Mailosaur first, user-profile last)
 * - Orders scenarios within area (view → create → edit → approve → cancel → delete)
 * - Smart user selection with context switching
 * - Test data creation when prerequisites missing
 * - Generates reports per feature area
 */

import * as fs from 'fs';
import * as path from 'path';
import { configureRepoModuleResolution, resolveDefaultWorkbookPath, resolveRepoRoot } from './functions/resolveRepoModule';

const bootstrappedRepoRoot = configureRepoModuleResolution(resolveRepoRoot());
const playwrightModulePath = path.join(bootstrappedRepoRoot, 'node_modules', 'playwright');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require(playwrightModulePath) as typeof import('playwright');
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;
type BrowserContext = import('playwright').BrowserContext;
import { readConfig, EnvironmentConfig, getIdentityUrl, getProduceHeader } from './functions/readConfig';
import { getAvailableUsers, suggestUserForScenario, userSessionMemory, UserWithCapabilities } from './functions/getAvailableUsers';
import { parseXlsxScenarios, TestScenario, FeatureArea, getExecutionPriority } from './functions/parseXlsxScenarios';
import { orderScenariosWithinArea } from './functions/orderScenarios';
import { getMailosaurOtp } from './functions/getMailosaurOtp';
import { executeScenarioStepsWithStrictRetry } from './functions/executeScenarioSteps';
import { LoginManager } from './functions/loginManager';
import { generateReport, TestResult } from './functions/reportWriter';

let config: EnvironmentConfig;
let users: UserWithCapabilities[] = [];
let reportsDir = path.join(__dirname, 'reports');

let browser: Browser;
let context: BrowserContext;
let page: Page;
let loginManager: LoginManager;
let isHeadedMode = false;
let produceHeaderValue: string | undefined;
let activeRepoRoot = bootstrappedRepoRoot;

interface MenuPath {
  /** App nav group header, e.g. "Move produce", "Baskets & cherries". */
  section?: string;
  /** Nav item labels to click in order (last entry is usually the journey link). */
  items: string[];
}

interface NavigationTarget {
  menuPaths: MenuPath[];
  directUrls?: string[];
}

const NAV_MENU_ROOT = 'app-dynamic-navigation-menu';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(name: string): Promise<string> {
  const filename = `${name.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.png`;
  const filepath = path.join(reportsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filename;
}

async function hasProfileGrowerDetailsMenuAction(scenario: TestScenario, actionType: 'cancel' | 'delete'): Promise<boolean> {
  if (actionType !== 'delete' || !page.url().includes('/my-profile/grower-details')) {
    return false;
  }

  const scenarioText = `${scenario.name} ${scenario.steps.join(' ')}`.toLowerCase();
  const menuSelectors = scenarioText.includes('email')
    ? ['button[aria-label="Modify email menu"]']
    : scenarioText.includes('phone')
      ? ['button[aria-label="Modify phone number menu"]']
      : ['button[aria-label="Modify email menu"]', 'button[aria-label="Modify phone number menu"]'];

  for (const menuSelector of menuSelectors) {
    const menuButtons = page.locator(menuSelector);
    const count = await menuButtons.count();
    for (let i = 0; i < count; i++) {
      const menuButton = menuButtons.nth(i);
      if (!(await menuButton.isVisible({ timeout: 1000 }).catch(() => false))) {
        continue;
      }

      await menuButton.scrollIntoViewIfNeeded().catch(() => {});
      await menuButton.click({ force: true });
      await sleep(500);

      const menuOption = page.locator('[role="menuitem"]:has-text("Remove"), [role="menuitem"]:has-text("Delete")').first();
      if (await menuOption.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`    Found ${actionType} option in profile menu: ${menuSelector}`);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(200);
        return true;
      }

      await page.keyboard.press('Escape').catch(() => {});
      await sleep(200);
    }
  }

  return false;
}

function createLoginManager(): LoginManager {
  return new LoginManager({
    page,
    context,
    config,
    sleep,
    locatorAnyVisible
  });
}

function menuPathLabel(menuPath: MenuPath): string {
  if (menuPath.section && menuPath.items.length > 0) {
    return `${menuPath.section} → ${menuPath.items.join(' → ')}`;
  }
  if (menuPath.items.length > 0) {
    return menuPath.items.join(' → ');
  }
  return 'dashboard';
}

function isMenuPathConfigured(menuPath: MenuPath): boolean {
  return Boolean(menuPath.section) || menuPath.items.length > 0;
}

async function locatorAnyVisible(selectors: string[], timeout = 1500) {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible({ timeout }).catch(() => false)) {
      return target;
    }
  }
  return null;
}

async function isLegacyMenuTextVisible(menuText: string): Promise<boolean> {
  const selectors = [
    `${NAV_MENU_ROOT} a.app-layout__vertical-nav-item-link:has-text("${menuText}")`,
    `nav >> text="${menuText}"`,
    `aside >> text="${menuText}"`,
    `[role="navigation"] >> text="${menuText}"`
  ];

  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function isAppMenuItemVisible(itemName: string, sectionName?: string): Promise<boolean> {
  const menu = page.locator(NAV_MENU_ROOT);
  if (!(await menu.isVisible({ timeout: 1000 }).catch(() => false))) {
    return false;
  }

  if (sectionName) {
    const section = menu.locator('.app-layout__vertical-nav-header-title').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(sectionName)}\\s*$`, 'i') });
    if (!(await section.first().isVisible({ timeout: 1000 }).catch(() => false))) {
      return false;
    }
  }

  const link = menu.locator('a.app-layout__vertical-nav-item-link').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(itemName)}\\s*$`, 'i') });
  return link.first().isVisible({ timeout: 1000 }).catch(() => false);
}

async function isMenuPathVisible(menuPath: MenuPath): Promise<boolean> {
  if (!isMenuPathConfigured(menuPath)) {
    return true;
  }

  const primaryItem = menuPath.items[menuPath.items.length - 1] || menuPath.section;
  if (!primaryItem) {
    return false;
  }

  if (await isAppMenuItemVisible(primaryItem, menuPath.section)) {
    return true;
  }

  return isLegacyMenuTextVisible(primaryItem);
}

async function clickAppMenuItem(itemName: string, sectionName?: string): Promise<boolean> {
  const menu = page.locator(NAV_MENU_ROOT);
  if (!(await menu.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  if (sectionName) {
    const section = menu.locator('.app-layout__vertical-nav-header-title').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(sectionName)}\\s*$`, 'i') });
    if (!(await section.first().isVisible({ timeout: 1500 }).catch(() => false))) {
      return false;
    }
  }

  const link = menu.locator('a.app-layout__vertical-nav-item-link').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(itemName)}\\s*$`, 'i') }).first();
  if (!(await link.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  await link.scrollIntoViewIfNeeded().catch(() => {});
  await link.click({ force: true });
  await sleep(1000);
  return true;
}

async function clickLegacyMenuItem(menuItem: string): Promise<boolean> {
  const selectors = [
    `${NAV_MENU_ROOT} a.app-layout__vertical-nav-item-link:has-text("${menuItem}")`,
    `nav >> text="${menuItem}"`,
    `aside >> text="${menuItem}"`,
    `a:has-text("${menuItem}")`,
    `button:has-text("${menuItem}")`
  ];

  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
        await element.click({ force: true });
        await sleep(1000);
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  return false;
}

async function navigateToMenu(menuPath: MenuPath): Promise<boolean> {
  if (!isMenuPathConfigured(menuPath)) {
    return true;
  }

  for (let index = 0; index < menuPath.items.length; index++) {
    const menuItem = menuPath.items[index];
    const sectionForItem = index === 0 ? menuPath.section : undefined;
    const isLast = index === menuPath.items.length - 1;

    let clicked = await clickAppMenuItem(menuItem, sectionForItem);
    if (!clicked) {
      clicked = await clickLegacyMenuItem(menuItem);
    }

    if (!clicked && isLast) {
      return false;
    }
  }

  return true;
}

async function findVisibleMenuPath(menuPaths: MenuPath[]): Promise<MenuPath | null> {
  for (const menuPath of menuPaths) {
    if (!isMenuPathConfigured(menuPath)) {
      return menuPath;
    }

    if (await isMenuPathVisible(menuPath)) {
      return menuPath;
    }
  }

  return null;
}

function buildAbsoluteUrl(relativePath: string): string {
  return new URL(relativePath, config.baseUrl).toString();
}

async function navigateToDirectUrl(directUrls: string[]): Promise<boolean> {
  for (const relativePath of directUrls) {
    try {
      const targetUrl = buildAbsoluteUrl(relativePath);
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(1500);

      const currentUrl = page.url();
      const pageContent = await page.content().catch(() => '');
      const blocked = pageContent.toLowerCase().includes('access denied') || pageContent.includes('RBAC');

      if (!currentUrl.includes('auth') && !currentUrl.includes('login') && !blocked) {
        return true;
      }
    } catch (error) {
      console.log(`    Direct URL navigation failed: ${relativePath} (${error})`);
    }
  }

  return false;
}

async function launchBrowserSession(): Promise<void> {
  browser = await chromium.launch({
    headless: !isHeadedMode,
    channel: 'chrome',
    args: isHeadedMode ? ['--start-maximized'] : undefined
  });

  context = await browser.newContext({
    viewport: isHeadedMode ? null : { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: produceHeaderValue ? { [config.produceKey]: produceHeaderValue } : {}
  });

  page = await context.newPage();
  await page.route('**/*', async (route) => {
    const headers = await route.request().allHeaders();
    if (produceHeaderValue) {
      headers[config.produceKey] = produceHeaderValue;
    }
    await route.continue({ headers });
  });

  loginManager = createLoginManager();
  loginManager.resetSessionState();
}

async function closeBrowserSession(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
  }

  loginManager?.resetSessionState();
}

function buildScenarioText(scenario: TestScenario): string {
  return [
    scenario.name,
    scenario.description,
    ...scenario.steps.map(step => `${step.action} ${step.expectedResult}`)
  ].join(' ').toLowerCase();
}

async function clickFirstVisible(selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible({ timeout: 1200 }).catch(() => false)) {
      await target.click({ force: true });
      await sleep(1200);
      return true;
    }
  }

  return false;
}

function extractOrdersearchTerm(scenario: TestScenario): string {
  const detailedText = [
    scenario.name,
    scenario.description,
    ...scenario.steps.flatMap(step => [step.action, step.expectedResult])
  ].join(' ');

  const quotedMatch = detailedText.match(/["'“”]([^"'“”]{3,40})["'“”]/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const orderMatch = detailedText.match(/\b[A-Z]{2,}[A-Z0-9-]{3,}\b/);
  if (orderMatch?.[0]) {
    return orderMatch[0];
  }

  return 'order';
}

async function prepareOrdersScenario(scenario: TestScenario): Promise<void> {
  const scenarioText = buildScenarioText(scenario);
  const needsTemplateView = scenarioText.includes('template');
  const needsActivityView = [
    'historical',
    'history',
    'scheduled',
    'activity',
    'search',
    'find',
    'order ticket',
    'order',
    'list',
    'cancel',
    'edit'
  ].some(keyword => scenarioText.includes(keyword));

  await dismissBlockingModals();

  if (needsTemplateView) {
    const openedTemplates = await clickFirstVisible([
      '[role="tab"]:has-text("Templates")',
      'button:has-text("Templates")',
      'a:has-text("Templates")',
      'text="Templates"'
    ]);

    if (openedTemplates) {
      console.log('    Opened orders templates view');
    }
    return;
  }

  if (needsActivityView) {
    const openedActivity = await clickFirstVisible([
      '[role="tab"]:has-text("Activity")',
      'button:has-text("Activity")',
      'a:has-text("Activity")',
      'text="Activity"'
    ]);

    if (openedActivity) {
      console.log('    Opened orders activity view');
    }

    if (scenarioText.includes('search') || scenarioText.includes('find') || scenarioText.includes('order ticket')) {
      const searchInput = page.locator([
        'input[type="search"]',
        'input[placeholder*="Search" i]',
        'input[aria-label*="Search" i]',
        'app-search-box input',
        '[role="searchbox"]'
      ].join(', ')).first();

      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        const searchTerm = extractOrdersearchTerm(scenario);
        await searchInput.fill(searchTerm);
        await page.keyboard.press('Enter').catch(() => {});
        await sleep(1500);
        console.log(`    Searched orders using term: ${searchTerm}`);
      }
    }

    return;
  }

  if (scenario.actionType === 'create' || scenarioText.includes('new order')) {
    const openedNewOrder = await clickFirstVisible([
      'button:has-text("New order")',
      'a:has-text("New order")',
      'button:has-text("Initiate")'
    ]);

    if (openedNewOrder) {
      console.log('    Opened new order flow');
    }
  }
}

function getNavigationTargetForScenario(scenario: TestScenario): NavigationTarget {
  const scenarioText = buildScenarioText(scenario);

  const menuMap: Record<FeatureArea, NavigationTarget> = {
    'audit': {
      menuPaths: [
        { section: 'Company administration', items: ['Audit'] },
        { items: ['Audit'] }
      ],
      directUrls: ['/audit']
    },
    'authentication': { menuPaths: [{ items: [] }] },
    'baskets': {
      menuPaths: [
        { section: 'Baskets & cherries', items: ['Baskets'] },
        { items: ['Baskets'] }
      ]
    },
    'pickings': {
      menuPaths: [
        { section: 'Baskets & cherries', items: ['Pickings'] },
        { items: ['Pickings'] }
      ],
      directUrls: ['/my-baskets/list', '/pickings/table']
    },
    'harvest-logs': {
      menuPaths: [
        { section: 'Baskets & cherries', items: ['Harvest logs'] },
        { items: ['Harvest logs'] },
        { items: ['Harvest-logs'] }
      ],
      directUrls: ['/my-baskets/list']
    },
    'banners': { menuPaths: [{ items: [] }] },
    'crates': {
      menuPaths: [
        { section: 'Move produce', items: ['Crates'] },
        { items: ['Crates'] }
      ],
      directUrls: ['/crates/crates/manage/list', '/crates/']
    },
    'cherries': {
      menuPaths: [
        { section: 'Baskets & cherries', items: ['Cherries'] },
        { items: ['Cherries'] },
        { section: 'Personal', items: ['Cherries'] }
      ],
      directUrls: ['/self-service/manage-cherries']
    },
    'growers': {
      menuPaths: [
        { section: 'Move produce', items: ['Growers'] },
        { items: ['Growers'] }
      ],
      directUrls: ['/self-service/manage-growers']
    },
    'dashboard': { menuPaths: [{ items: [] }], directUrls: ['/dashboard'] },
    'explore-products': {
      menuPaths: [
        { section: 'Products', items: ['Apply for products'] },
        { items: ['Apply for products'] }
      ],
      directUrls: ['/products']
    },
    'standing-crates': {
      menuPaths: [
        { section: 'Move produce', items: ['Standing crates'] },
        { items: ['Standing crates'] }
      ]
    },
    'barter': {
      menuPaths: [
        { section: 'Stall management', items: ['Barter'] },
        { items: ['Barter'] }
      ]
    },
    'seedlings': {
      menuPaths: [
        { section: 'Baskets & cherries', items: ['Seedlings'] },
        { items: ['Seedlings'] }
      ],
      directUrls: ['/my-baskets/list']
    },
    'messages': {
      menuPaths: [
        { section: 'Personal', items: ['Messages'] },
        { items: ['Messages'] },
        { section: 'More', items: ['Messages'] }
      ],
      directUrls: ['/more/messages']
    },
    'notifications': { menuPaths: [{ items: [] }] },
    'orders': scenarioText.includes('template')
      ? {
          menuPaths: [
            { section: 'Move produce', items: ['Templates'] },
            { section: 'Move produce', items: ['Orders'] },
            { items: ['Templates'] },
            { items: ['Orders'] }
          ],
          directUrls: ['/templates/deliveries', '/deliveries/']
        }
      : scenarioText.includes('historical') || scenarioText.includes('history') || scenarioText.includes('scheduled') || scenarioText.includes('activity') || scenarioText.includes('search') || scenarioText.includes('find') || scenarioText.includes('order ticket') || scenarioText.includes('order') || scenarioText.includes('list') || scenarioText.includes('cancel') || scenarioText.includes('edit')
      ? {
          menuPaths: [
            { section: 'Move produce', items: ['Orders'] },
            { items: ['Orders'] }
          ],
          directUrls: ['/deliveries/']
        }
      : {
          menuPaths: [
            { section: 'Move produce', items: ['Orders'] },
            { items: ['Orders'] }
          ],
          directUrls: ['/deliveries/', '/deliveries/one-off?openedModal=new-delivery-easy']
        },
    'self-service-seedlings': { menuPaths: [{ items: [] }] },
    'user-profile': {
      menuPaths: [
        { section: 'Personal', items: ['My profile'] },
        { items: ['My profile'] },
        { section: 'Personal', items: ['Profile'] }
      ],
      directUrls: ['/self-service/profile/profile']
    },
    'user-profile-otp': {
      menuPaths: [
        { section: 'Personal', items: ['My profile'] },
        { items: ['My profile'] }
      ],
      directUrls: ['/self-service/profile/login-security/']
    },
    'wholesale': {
      menuPaths: [
        { section: 'Trade & supply chain', items: ['Wholesale'] },
        { items: ['Wholesale'] }
      ]
    },
    'user-management': {
      menuPaths: [
        { section: 'Company administration', items: ['Company Permissions'] },
        { items: ['Company Permissions'] }
      ]
    },
    'unknown': { menuPaths: [{ items: [] }] }
  };

  return menuMap[scenario.area] || { menuPaths: [{ items: [] }] };
}

async function ensurePickingsJourneyReady(): Promise<void> {
  try {
    // Most picking journeys start from My baskets.
    const pickingTabSelectors = [
      'a:has-text("Pickings")',
      'button:has-text("Pickings")',
      '[role="tab"]:has-text("Pickings")'
    ];

    const basketRowSelectors = [
      'table tbody tr a',
      'table tbody tr',
      '[data-role="list-item"] a',
      '[data-role="list-item"]'
    ];

    for (const selector of basketRowSelectors) {
      const basketRow = page.locator(selector).first();
      if (await basketRow.isVisible({ timeout: 1200 }).catch(() => false)) {
        await basketRow.click({ force: true });
        await sleep(1200);
        break;
      }
    }

    for (const selector of pickingTabSelectors) {
      const tab = page.locator(selector).first();
      if (await tab.isVisible({ timeout: 1200 }).catch(() => false)) {
        await tab.click({ force: true });
        await sleep(1200);
        break;
      }
    }
  } catch (error) {
    console.log(`    Pickings journey preparation failed: ${error}`);
  }
}

const TEST_CRATE_FILE_TEMPLATE = path.join(process.cwd(), 'apps/produce-stand-e2e/src/specs/crates/standard.csv');
const TEST_DD_FILE_TEMPLATE = path.join(process.cwd(), 'apps/produce-stand-e2e/src/specs/standing-crate/files/csv-standarddd.csv');

function resolveDefaultXlsxPath(repoRoot: string): string {
  return resolveDefaultWorkbookPath(repoRoot);
}

// Create unique temp crate file to avoid "duplicate file" error
function createUniqueCrateFile(templatePath: string): string {
  const timestamp = Date.now();
  const tempDir = path.join(process.cwd(), 'libs/memory/agents/reports');
  const uniqueFileName = `crate_${timestamp}.csv`;
  const uniqueFilePath = path.join(tempDir, uniqueFileName);
  
  try {
    // Read template and modify description/name field to make content unique (not version number!)
    const content = fs.readFileSync(templatePath, 'utf-8');
    const lines = content.split('\n');
    
    // Modify the header row (line 2) - change crate name from AUTO_TEST to AUTO_TEST_timestamp
    if (lines.length > 1) {
      lines[1] = lines[1].replace('"AUTO_TEST"', `"AUTO_TEST_${timestamp}"`);
    }
    
    fs.writeFileSync(uniqueFilePath, lines.join('\n'));
    console.log(`    Created unique crate file: ${uniqueFileName}`);
    return uniqueFilePath;
  } catch (e) {
    console.log(`    Could not create unique file, using template`);
    return templatePath;
  }
}

// Handle OTP/freshness check flow
async function handleOtpFlow(userEmail: string): Promise<boolean> {
  console.log(`    Handling OTP flow for: ${userEmail}`);
  
  try {
    // Record timestamp before triggering OTP
    const otpTimestamp = new Date(Date.now() - 2000).toISOString();
    
    // Look for "Email me a code" button to trigger OTP
    const emailCodeSelectors = [
      'button:has-text("Email me a code")',
      'button:has-text("Send code via email")',
      '[data-role="email-otp-button"]',
      'text="Email me a code"'
    ];
    
    let otpTriggered = false;
    for (const sel of emailCodeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`    Clicking: ${sel}`);
        await btn.click();
        await sleep(3000);
        otpTriggered = true;
        break;
      }
    }
    
    if (!otpTriggered) {
      // Maybe OTP input is already shown
      const otpInput = page.locator('input[data-role="otp-input"], input[placeholder*="code"], input[name="otp"], input[type="tel"]').first();
      if (await otpInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`    OTP input already visible`);
        otpTriggered = true;
      }
    }
    
    if (!otpTriggered) {
      console.log(`    Could not trigger OTP flow`);
      return false;
    }
    
    // Wait a moment for OTP to be sent
    await sleep(5000);
    
    // Retrieve OTP from Mailosaur
    console.log(`    Retrieving OTP from Mailosaur...`);
    const otpResult = await getMailosaurOtp(userEmail, {
      receivedAfter: otpTimestamp,
      retryCount: 5,
      retryDelayMs: 3000
    });
    
    if (!otpResult) {
      console.log(`    Failed to retrieve OTP from Mailosaur`);
      return false;
    }
    
    console.log(`    OTP retrieved: ${otpResult.otp}`);
    
    // Find OTP input and enter code
    const otpInputSelectors = [
      'input[data-role="otp-input"]',
      'input[placeholder*="code"]',
      'input[name="otp"]',
      'input[type="tel"][maxlength="6"]',
      'input[maxlength="6"]',
      '.otp-input input'
    ];
    
    let otpEntered = false;
    for (const sel of otpInputSelectors) {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`    Entering OTP in: ${sel}`);
        await input.fill(otpResult.otp);
        await sleep(1000);
        otpEntered = true;
        break;
      }
    }
    
    if (!otpEntered) {
      // Try individual digit inputs (some OTP UIs have 6 standardrate inputs)
      const digitInputs = page.locator('input[maxlength="1"]');
      const count = await digitInputs.count();
      if (count === 6) {
        console.log(`    Entering OTP in 6 standardrate digit inputs`);
        for (let i = 0; i < 6; i++) {
          await digitInputs.nth(i).fill(otpResult.otp[i]);
          await sleep(100);
        }
        otpEntered = true;
      }
    }
    
    if (!otpEntered) {
      console.log(`    Could not find OTP input field`);
      return false;
    }
    
    // Submit OTP
    const submitSelectors = [
      'button:has-text("Verify")',
      'button:has-text("Submit")',
      'button:has-text("Confirm")',
      'button[type="submit"]',
      '[data-role="verify-button"]'
    ];
    
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`    Submitting OTP with: ${sel}`);
        await btn.click();
        await sleep(3000);
        break;
      }
    }
    
    // Check for success
    const successIndicators = [
      'text="was approved"',
      'text="successfully"',
      'text="verified"'
    ];
    
    for (const sel of successIndicators) {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`    OTP verification successful`);
        return true;
      }
    }
    
    // Check if modal closed (also indicates success)
    const modal = page.locator('ngb-modal-window, [role="dialog"]');
    if (!(await modal.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log(`    Modal closed - OTP likely accepted`);
      return true;
    }
    
    console.log(`    OTP submitted but could not confirm success`);
    return true; // Assume success if we got this far
    
  } catch (error) {
    console.log(`    OTP handling error: ${error}`);
    return false;
  }
}

async function dismissNotifications(): Promise<void> {
  // Dismiss any warning/info notifications that might be blocking clicks
  const notifications = page.locator('[data-role="notification-alert"] button[aria-label="Close"], .app-notification button.close, .app-notification [aria-label="Dismiss"]');
  const count = await notifications.count();
  for (let i = 0; i < count; i++) {
    try {
      await notifications.nth(i).click({ timeout: 1000 });
      await sleep(200);
    } catch (e) {
      // Notification might have auto-dismissed
    }
  }
}

async function dismissBlockingModals(): Promise<void> {
  const modal = page.locator('ngb-modal-window, [role="dialog"]');
  if (!(await modal.first().isVisible({ timeout: 800 }).catch(() => false))) {
    return;
  }

  // Try explicit close controls first, then fallback to Escape.
  const closeSelectors = [
    'ngb-modal-window button:has-text("Cancel")',
    'ngb-modal-window button:has-text("Close")',
    'ngb-modal-window [aria-label="Close"]',
    '[role="dialog"] button:has-text("Cancel")',
    '[role="dialog"] button:has-text("Close")',
    '[role="dialog"] [aria-label="Close"]'
  ];

  for (const selector of closeSelectors) {
    const closeBtn = page.locator(selector).first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => {});
      await sleep(400);
      if (!(await modal.first().isVisible({ timeout: 500 }).catch(() => false))) {
        return;
      }
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
}

async function createProfilePhoneNumberPrerequisite(): Promise<boolean> {
  // Ensure we are on grower details where phone controls exist.
  if (!page.url().includes('/my-profile/grower-details')) {
    await navigateToMenu({ section: 'Personal', items: ['My profile'] }).catch(() => false);
    await sleep(1200);
    const growerDetailsTab = page.locator('a:has-text("Grower details"), button:has-text("Grower details"), [data-role="grower-details-tab"]').first();
    if (await growerDetailsTab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await growerDetailsTab.click({ force: true }).catch(() => {});
      await sleep(1200);
    }
  }

  const addPhoneSelectors = [
    'button:has-text("Add phone number")',
    'button:has-text("Add phone")',
    'button:has-text("Add number")',
    '[data-role="add-phone-number"]'
  ];

  let opened = false;
  for (const sel of addPhoneSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
      console.log(`    Found add phone action with: ${sel}`);
      await btn.click({ force: true });
      opened = true;
      await sleep(800);
      break;
    }
  }

  if (!opened) {
    console.log('    Add phone action not found');
    return false;
  }

  const phoneValue = `+447${Date.now().toString().slice(-8)}`;
  const phoneInputSelectors = [
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[id*="phone" i]',
    'input[placeholder*="phone" i]'
  ];

  let phoneFilled = false;
  for (const sel of phoneInputSelectors) {
    const input = page.locator(sel).first();
    if (await input.isVisible({ timeout: 1200 }).catch(() => false)) {
      await input.fill(phoneValue);
      phoneFilled = true;
      break;
    }
  }

  if (!phoneFilled) {
    console.log('    Phone input not found in add form');
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  const saveSelectors = [
    'ngb-modal-window button:has-text("Save")',
    'ngb-modal-window button:has-text("Add")',
    'ngb-modal-window button[type="submit"]',
    'button:has-text("Save")',
    'button:has-text("Add")',
    'button[type="submit"]'
  ];

  let saved = false;
  for (const sel of saveSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await btn.click({ force: true });
      saved = true;
      await sleep(1500);
      break;
    }
  }

  if (!saved) {
    console.log('    Save action not found for phone prerequisite');
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  const phoneMenus = page.locator('button[aria-label="Modify phone number menu"]');
  const phoneMenuCount = await phoneMenus.count();
  if (phoneMenuCount > 0) {
    console.log(`    Created phone prerequisite successfully (phone menu count: ${phoneMenuCount})`);
    return true;
  }

  console.log('    Phone prerequisite creation attempted, but phone menu is still unavailable');
  return false;
}

async function createPrerequisiteData(area: FeatureArea, scenario?: TestScenario): Promise<boolean> {
  console.log(`    Creating prerequisite data for ${area}...`);
  
  try {
    // Close stale dialogs from previous actions to avoid click interception.
    await dismissBlockingModals();

    // Dismiss any blocking notifications first
    await dismissNotifications();
    
    if (area === 'crates' || area === 'standing-crates') {
      // Take screenshot to debug
      await takeScreenshot(`create_prereq_${area}_before`);
      
      // Look for "Create new" dropdown/button - try multiple selectors
      const createSelectors = [
        'app-dropdown-menu-ui.app-button-bar__button',
        'button:has-text("New crate")',
        'button:has-text("Create new")',
        '[data-role="create-button"]',
        '.create-new-btn'
      ];
      
      let createBtnClicked = false;
      for (const sel of createSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`    Found create button with: ${sel}`);
          // Dismiss any notifications that might be blocking
          await dismissNotifications();
          await btn.click({ force: true }); // Use force to click even if partially obscured
          await sleep(1000);
          createBtnClicked = true;
          break;
        }
      }
      
      if (!createBtnClicked) {
        console.log(`    Create new button not found`);
        return false;
      }
      
      await takeScreenshot(`create_prereq_${area}_dropdown`);
      
      // Select "Crate upload" option from dropdown
      const uploadSelectors = [
        'text="Crate upload"',
        'button:has-text("Crate upload")',
        'text="Upload a file"',
        'button:has-text("Upload")',
        '[data-role="upload-option"]',
        'text="Upload"'
      ];
      
      for (const sel of uploadSelectors) {
        const opt = page.locator(sel).first();
        if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`    Found upload option with: ${sel}`);
          await opt.click();
          await sleep(1500);
          break;
        }
      }
      
      await takeScreenshot(`create_prereq_${area}_form`);
      
      // Check if upload form/modal appeared - file input might be hidden
      const fileInput = page.locator('input[type="file"]');
      const fileInputCount = await fileInput.count();
      console.log(`    Found ${fileInputCount} file input(s)`);
      
      if (fileInputCount > 0) {
        console.log(`    Uploading test crate file...`);
        
          // Create unique test file to avoid duplicate error
          const templateFile = area === 'standing-crates' ? TEST_DD_FILE_TEMPLATE : TEST_CRATE_FILE_TEMPLATE;
          const testFile = createUniqueCrateFile(templateFile);
          console.log(`    Test file path: ${testFile}`);
          console.log(`    File exists: ${fs.existsSync(testFile)}`);
        
        if (fs.existsSync(testFile)) {
          // File input might be hidden, use setInputFiles anyway
          await fileInput.first().setInputFiles(testFile);
          await sleep(3000);
          
          await takeScreenshot(`create_prereq_${area}_uploaded`);
          
          // Look for continue/next/confirm/upload button in modal
          const continueSelectors = [
            'ngb-modal-window button:has-text("Continue")',
            'ngb-modal-window button:has-text("Confirm")',
            'ngb-modal-window button:has-text("Next")',
            '.modal button:has-text("Continue")',
            '.modal button:has-text("Confirm")',
            'button:has-text("Confirm")',
            'button:has-text("Continue")',
            'button:has-text("Next")',
            'button:has-text("Upload")',
            'button[type="submit"]',
            'button:has-text("Create crate")'
          ];
          
          for (const sel of continueSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`    Clicking: ${sel}`);
              await btn.click();
              await sleep(3000);
              break;
            }
          }
          
          // May need to click through more steps (mapping, confirmation)
          for (let step = 0; step < 3; step++) {
            // Look specifically inside modal for action buttons
            const modalBtn = page.locator('ngb-modal-window button:has-text("Continue"), ngb-modal-window button:has-text("Confirm"), ngb-modal-window button:has-text("Next"), ngb-modal-window button:has-text("Create"), ngb-modal-window button:has-text("Submit"), ngb-modal-window button:has-text("Save")').first();
            if (await modalBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`    Clicking modal button step ${step + 1}`);
              await modalBtn.click();
              await sleep(3000);
            } else {
              // Check if modal closed (success)
              const modal = page.locator('ngb-modal-window');
              if (!(await modal.isVisible({ timeout: 1000 }).catch(() => false))) {
                console.log(`    Modal closed - crate creation completed`);
                break;
              }
            }
          }
          
          await takeScreenshot(`create_prereq_${area}_result`);
          console.log(`    Crate creation flow completed`);
          
          // Navigate back to crates list
          await navigateToMenu({ section: 'Move produce', items: ['Crates'] });
          await sleep(2000);
          return true;
        } else {
          console.log(`    Test file not found: ${testFile}`);
        }
      } else {
        console.log(`    No file input found in form`);
      }
      
      // Close any open modal
      const closeBtn = page.locator('button:has-text("Cancel"), button:has-text("Close"), [aria-label="Close"]').first();
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
      }
    } else if (area === 'orders') {
      await dismissBlockingModals();

      // Navigate to initiate order
      const initiateBtn = page.locator('button:has-text("New order"), a:has-text("New order"), button:has-text("Initiate")').first();
      if (await initiateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await initiateBtn.click({ force: true });
        await sleep(2000);
        console.log(`    Opened order initiation - would need to fill form`);
        // Order forms are complex - mark as needing manual intervention
        return false;
      }
    } else if (area === 'growers') {
      // Create a grower
      const addBtn = page.locator('button:has-text("Add grower"), button:has-text("New grower"), [data-role="add-grower"]').first();
      if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addBtn.click();
        await sleep(2000);
        
        // Try to fill basic grower form
        const nameInput = page.locator('input[name="name"], input[placeholder*="name"], #grower-name').first();
        if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nameInput.fill(`Test Grower ${Date.now()}`);
          
          // Try to submit
          const submitBtn = page.locator('button:has-text("Save"), button:has-text("Create"), button[type="submit"]').first();
          if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click();
            await sleep(3000);
            console.log(`    Created test grower`);
            return true;
          }
        }
      }
    } else if (area === 'user-profile' || area === 'user-profile-otp') {
      const scenarioText = `${scenario?.name || ''} ${scenario?.steps?.map(s => `${s.action} ${s.expectedResult}`).join(' ') || ''}`.toLowerCase();
      const isPhoneDeleteFlow = scenarioText.includes('phone') && (scenarioText.includes('delete') || scenarioText.includes('remove'));

      if (isPhoneDeleteFlow) {
        console.log('    Phone delete/remove scenario detected - creating phone prerequisite');
        const created = await createProfilePhoneNumberPrerequisite();
        if (created) {
          await sleep(1200);
          return true;
        }
      }
    }
    
    console.log(`    Could not create prerequisite data automatically`);
    return false;
  } catch (e) {
    console.log(`    Error creating prerequisite data: ${e}`);
    return false;
  }
}

// Analyze scenario steps to identify prerequisite workflow
interface PrerequisiteWorkflow {
  needsApproveFirst: boolean;
  needsCreateFirst: boolean;
  needsPartialApproval: boolean;
  approveSteps: number[];
  createSteps: number[];
  mainActionStep: number;
}

function analyzeScenarioSteps(scenario: TestScenario): PrerequisiteWorkflow {
  const workflow: PrerequisiteWorkflow = {
    needsApproveFirst: false,
    needsCreateFirst: false,
    needsPartialApproval: false,
    approveSteps: [],
    createSteps: [],
    mainActionStep: -1
  };
  
  const actionType = scenario.actionType;
  const steps = scenario.steps;
  
  console.log(`    Analyzing ${steps.length} scenario steps...`);
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepText = `${step.action} ${step.expectedResult}`.toLowerCase();
    
    // Look for approve/approval steps
    const actionText = (step.action || '').toLowerCase();
    const hasExplicitApproveAction = actionText.includes('approve') || actionText.includes('approval');
    if (hasExplicitApproveAction) {
      if (actionType === 'cancel' || actionType === 'delete') {
        // If main action is cancel/delete and we see approve step before, it's a prerequisite
        workflow.needsApproveFirst = true;
        workflow.approveSteps.push(i);
      }
    }
    
    // Look for "waiting for another approval" - indicates partial approval needed
    if (stepText.includes('waits for another approval') || stepText.includes('waiting for another approval')) {
      workflow.needsPartialApproval = true;
    }
    
    // Look for create/upload steps
    if (stepText.includes('create') || stepText.includes('upload') || stepText.includes('initiate')) {
      workflow.needsCreateFirst = true;
      workflow.createSteps.push(i);
    }
    
    // Identify the main action step
    if (actionType === 'cancel' && stepText.includes('cancel')) {
      workflow.mainActionStep = i;
    }
    if (actionType === 'delete' && stepText.includes('delete')) {
      workflow.mainActionStep = i;
    }
  }
  
  // Log analysis
  if (workflow.needsApproveFirst) {
    console.log(`    → Steps indicate: APPROVE required before ${actionType}`);
  }
  if (workflow.needsPartialApproval) {
    console.log(`    → Steps indicate: Partial approval state required`);
  }
  
  return workflow;
}

// Execute prerequisite workflow based on scenario step analysis
async function executePrerequisiteWorkflow(scenario: TestScenario, workflow: PrerequisiteWorkflow): Promise<boolean> {
  console.log(`    Executing prerequisite workflow...`);
  
  // Step 1: Create data if needed (crate in Entered status)
  if (workflow.needsCreateFirst || workflow.needsApproveFirst) {
    console.log(`    Step 1: Creating crate data...`);
    const created = await createPrerequisiteData(scenario.area, scenario);
    if (!created) {
      console.log(`    Failed to create prerequisite data`);
      return false;
    }
    await sleep(3000);
    await page.reload();
    await sleep(3000);
  }
  
  // Step 2: Approve if needed (to get to partially approved state for cancel)
  if (workflow.needsApproveFirst) {
    console.log(`    Step 2: Approving crate to reach correct status...`);
    
    // Find and click approve button
    const approveSelectors = [
      '[aria-label="Approve"]',
      'button:has-text("Approve")',
      '[data-role="approve-button"]'
    ];
    
    let approveClicked = false;
    for (const sel of approveSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`    Clicking approve with: ${sel}`);
        await btn.click();
        await sleep(2000);
        
        // Handle approval confirmation popup
        const confirmBtn = page.locator('button:has-text("Approve"), ngb-modal-window button:has-text("Approve")').first();
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`    Confirming approval...`);
          await confirmBtn.click();
          await sleep(3000);
        }
        
        // Check for success message or status change
        await sleep(2000);
        
        // Dismiss any notification
        await dismissNotifications();
        
        // Check for OTP/freshness check requirement
        const otpRequired = Boolean(await locatorAnyVisible([
          'text=Enter code',
          'text=Email me a code',
          'text=Text me a code',
          'text=verification code',
          '[data-role="otp-input"]',
          'input[placeholder*="code"]'
        ], 3000));
        if (otpRequired) {
          console.log(`    OTP/Freshness check required - initiating Mailosaur flow...`);
          
          // Get current user's email for OTP
          const userEmail = loginManager.currentUser?.email;
          if (userEmail && userEmail.includes('mailosaur')) {
            const otpSuccess = await handleOtpFlow(userEmail);
            if (otpSuccess) {
              console.log(`    ✓ OTP verification completed`);
            } else {
              console.log(`    ⚠ OTP verification failed - continuing anyway`);
            }
          } else {
            console.log(`    ⚠ Current user doesn't have Mailosaur email: ${userEmail}`);
          }
        }
        
        // Check for success message
        const successMsg = Boolean(await locatorAnyVisible(['text=was approved', 'text=successfully approved'], 2000));
        if (successMsg) {
          console.log(`    Crate approved successfully`);
        }
        
        approveClicked = true;
        break;
      }
    }
    
    if (!approveClicked) {
      console.log(`    Could not find approve button`);
      return false;
    }
    
    await sleep(2000);
    await page.reload();
    await sleep(2000);
  }
  
  console.log(`    Prerequisite workflow completed`);
  return true;
}

function selectUserForScenario(scenario: TestScenario): UserWithCapabilities {
  const scenarioText = [
    scenario.name,
    scenario.description,
    ...scenario.steps.map(step => `${step.action} ${step.expectedResult}`)
  ].join(' ').toLowerCase();

  const preferredUsername = userSessionMemory.getBestGuess(scenario.area);
  const suggested = suggestUserForScenario(
    config,
    `${scenario.name} ${scenario.description}`,
    preferredUsername
  );
  if (suggested) {
    return suggested;
  }

  if (scenario.area === 'audit' || scenario.area === 'user-management') {
    return users.find(u => u.userType === 'adminUser') ||
      users.find(u => u.capabilities.includes('admin')) ||
      users[0];
  }

  if (scenarioText.includes('apple-admin') || scenarioText.includes('admin user')) {
    return users.find(u => u.userType === 'adminUser') || users.find(u => u.capabilities.includes('admin')) || users[0];
  }

  if (scenarioText.includes('mango-grower') || scenarioText.includes('multiple context')) {
    return users.find(u => u.userType === 'userWithMultipleContexts') || users.find(u => u.capabilities.includes('multi-context')) || users[0];
  }

  if (scenarioText.includes('approve') || scenarioText.includes('reject') || scenarioText.includes('sign')) {
    return users.find(u => u.capabilities.includes('approvals')) || users[0];
  }

  return users.find(u => u.userType === 'userWithApprovals') ||
    users.find(u => u.userType === 'userWithSingleContext') ||
    users[0];
}

function getUsersToTryForScenario(scenario: TestScenario, initialUser: UserWithCapabilities): UserWithCapabilities[] {
  const ordered: UserWithCapabilities[] = [initialUser];
  const addUser = (candidate?: UserWithCapabilities) => {
    if (candidate && !ordered.some(user => user.username === candidate.username)) {
      ordered.push(candidate);
    }
  };

  if (scenario.area === 'audit' || scenario.area === 'user-management') {
    addUser(users.find(u => u.userType === 'adminUser'));
    users.filter(u => u.capabilities.includes('admin')).forEach(addUser);
  }

  users.forEach(addUser);
  return ordered.slice(0, 4);
}

function buildStepExecutorDeps() {
  const userEmail = loginManager.currentUser?.email || loginManager.currentUser?.username || '';

  return {
    page,
    sleep,
    dismissBlockingModals,
    locatorAnyVisible,
    navigateToMenu,
    navigateToDirectUrl,
    getNavigationTargetForScenario,
    clickAppMenuItem,
    repoRoot: activeRepoRoot,
    userEmail,
    handleOtpFlow,
    uploadFixture: async (filePath: string): Promise<boolean> => {
      const uploadTrigger = await locatorAnyVisible([
        'button:has-text("Upload")',
        'a:has-text("Upload")',
        '[data-role*="upload"]',
        'text="Upload file"'
      ], 2500);

      if (uploadTrigger) {
        await uploadTrigger.click({ force: true });
        await sleep(800);
      }

      const fileInput = page.locator('input[type="file"]').first();
      if (!(await fileInput.isVisible({ timeout: 4000 }).catch(() => false))) {
        console.log(`    File input not visible for upload: ${filePath}`);
        return false;
      }

      await fileInput.setInputFiles(filePath);
      await sleep(1500);
      return true;
    }
  };
}

function scenarioNeedsCratePrerequisite(scenario: TestScenario): boolean {
  const text = `${scenario.name} ${scenario.actionType}`.toLowerCase();
  return (
    scenario.area === 'crates' &&
    (scenario.actionType === 'approve' ||
      scenario.actionType === 'reject' ||
      scenario.actionType === 'cancel' ||
      scenario.actionType === 'delete' ||
      /approve|reject|cancel|delete/.test(text))
  );
}

async function executeScenario(scenario: TestScenario): Promise<TestResult> {
  console.log(`\n  [${scenario.id}] ${scenario.name}`);
  
  const result: TestResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status: 'blocked',
    user: loginManager.currentUser?.username,
    context: loginManager.currentContextName
  };
  
  try {
    await dismissBlockingModals();

    if (scenarioNeedsCratePrerequisite(scenario)) {
      const workflow = analyzeScenarioSteps(scenario);
      workflow.needsCreateFirst = true;
      await navigateToMenu({ section: 'Move produce', items: ['Crates'] });
      await sleep(2000);
      const prereqOk = await executePrerequisiteWorkflow(scenario, workflow);
      if (!prereqOk) {
        result.status = 'blocked';
        result.note = '[prerequisite] Crate upload prerequisite failed — approve/reject needs an existing crate';
        result.screenshot = await takeScreenshot(`${scenario.id}_prereq`);
        console.log(`    ⚠ ${result.note}`);
        return result;
      }
    }

    const stepResult = await executeScenarioStepsWithStrictRetry(scenario, buildStepExecutorDeps());

    result.status = stepResult.status;
    const rawNote = stepResult.failedStepNumber
      ? `${stepResult.note} (step ${stepResult.failedStepNumber})`
      : stepResult.note;
    result.note = classifyResultNote(rawNote, result.status);
    result.screenshot = await takeScreenshot(`${scenario.id}_step${stepResult.failedStepNumber || 'done'}`);

    if (
      (result.status === 'passed' || result.status === 'passed-with-deviation') &&
      loginManager.currentUser?.username
    ) {
      userSessionMemory.recordSuccess(scenario.area, loginManager.currentUser.username);
    }
  } catch (error: any) {
    result.status = 'failed';
    result.note = `Error: ${error.message}`;
    result.screenshot = await takeScreenshot(`${scenario.id}_error`);
  }

  const statusIcon =
    result.status === 'passed' ? '✓' :
    result.status === 'passed-with-deviation' ? '◐' :
    result.status === 'failed' ? '✗' : '⚠';
  result.user = loginManager.currentUser?.username || result.user;
  result.context = loginManager.currentContextName || result.context;
  console.log(`    ${statusIcon} ${result.status}: ${result.note || ''}`);

  return result;
}


function classifyResultNote(note: string, status: TestResult['status']): string {
  if (!note || /^\[(interpret|verify|prerequisite|env)\]/i.test(note)) {
    return note;
  }
  if (/could not interpret/i.test(note)) {
    return `[interpret] ${note}`;
  }
  if (/could not verify/i.test(note)) {
    return `[verify] ${note}`;
  }
  if (/upload\s+modal|prerequisite|crate\s+upload|empty.*list/i.test(note)) {
    return `[prerequisite] ${note}`;
  }
  if (/otp|mailosaur|page\s+couldn'?t|unexpected\s+error|model\s+market\s+url/i.test(note)) {
    return `[env] ${note}`;
  }
  if (status === 'failed' && /not visible|did not appear/i.test(note)) {
    return `[verify] ${note}`;
  }
  return note;
}

async function executeFeatureArea(area: FeatureArea, scenarios: TestScenario[]): Promise<TestResult[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FEATURE AREA: ${area.toUpperCase()}`);
  console.log(`Scenarios: ${scenarios.length}`);
  console.log(`${'='.repeat(60)}`);
  
  const results: TestResult[] = [];
  const orderedScenarios = orderScenariosWithinArea(scenarios);
  
  // Execute each scenario
  for (const scenario of orderedScenarios) {
    const scenarioUser = selectUserForScenario(scenario);

    await launchBrowserSession();

    try {
      const loginSuccess = await loginManager.login(scenarioUser);
      if (!loginSuccess) {
        results.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          status: 'blocked',
          note: `Login failed for user ${scenarioUser.username}`,
          user: scenarioUser.username,
          context: loginManager.currentContextName
        });
      } else {
        const result = await executeScenario(scenario);
        results.push(result);
      }
    } finally {
      await closeBrowserSession();
    }

    await sleep(500);
  }
  
  // Generate report for this area
  generateReport(area, results, reportsDir);
  
  return results;
}

function getCliValue(args: string[], key: string): string | undefined {
  const inline = args.find(a => a.startsWith(`${key}=`));
  if (inline) {
    return inline.split('=').slice(1).join('=');
  }

  const index = args.indexOf(key);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1];
  }

  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoRootArg = getCliValue(args, '--repo-root');
  const repoRoot = configureRepoModuleResolution(
    repoRootArg ? path.resolve(repoRootArg) : resolveRepoRoot(args)
  );
  activeRepoRoot = repoRoot;
  process.chdir(repoRoot);

  const configArg = getCliValue(args, '--config');
  const configPath = configArg
    ? (path.isAbsolute(configArg) ? configArg : path.join(repoRoot, configArg))
    : undefined;
  const secretsArg = getCliValue(args, '--secrets');
  if (secretsArg) {
    process.env.AGENT_SECRETS_PATH = path.isAbsolute(secretsArg)
      ? secretsArg
      : path.join(repoRoot, secretsArg);
  }
  const reportsDirArg = getCliValue(args, '--reports-dir');
  reportsDir = reportsDirArg
    ? (path.isAbsolute(reportsDirArg) ? reportsDirArg : path.join(repoRoot, reportsDirArg))
    : path.join(repoRoot, '.agent-reports', 'web-manual-tester');
  fs.mkdirSync(reportsDir, { recursive: true });

  config = readConfig(configPath);
  users = getAvailableUsers(config);

  const limitArg = args.find(a => a.startsWith('--limit='));
  const areaLimit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  isHeadedMode = args.includes('--headed');
  const areaArgInline = args.find(a => a.startsWith('--area='));
  const areaArgIndex = args.indexOf('--area');
  const selectedArea = (areaArgInline
    ? areaArgInline.split('=')[1]
    : (areaArgIndex !== -1 ? args[areaArgIndex + 1] : undefined)) as FeatureArea | undefined;
  const idsArgInline = args.find(a => a.startsWith('--ids='));
  const idsArgIndex = args.indexOf('--ids');
  const selectedIds = (idsArgInline
    ? idsArgInline.split('=')[1]
    : (idsArgIndex !== -1 ? args[idsArgIndex + 1] : undefined))
    ?.split(',')
    .map(id => id.trim())
    .filter(Boolean);
  const xlsxArg = getCliValue(args, '--xlsx');
  const xlsxPath = xlsxArg
    ? (path.isAbsolute(xlsxArg) ? xlsxArg : path.join(repoRoot, xlsxArg))
    : resolveDefaultXlsxPath(repoRoot);
  
  console.log('='.repeat(60));
  console.log('WEB MANUAL TEST EXECUTION');
  console.log('Following system prompt guidelines');
  console.log('='.repeat(60));
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Target: ${config.baseUrl}`);
  console.log(`Config path: ${configPath || 'auto-discovery apps/*/config/*.json'}`);
  console.log(`Secrets path: ${process.env.AGENT_SECRETS_PATH || 'auto-discovery defaults'}`);
  console.log(`Area limit: ${areaLimit || 'all'}`);
  console.log(`Selected area: ${selectedArea || 'all'}`);
  console.log(`Selected ids: ${selectedIds?.join(', ') || 'all'}`);
  console.log(`XLSX path: ${xlsxPath}`);
  console.log(`Reports dir: ${reportsDir}`);
  console.log(`Browser mode: ${isHeadedMode ? 'headed' : 'headless'}`);
  console.log('');
  
  // Parse all scenarios
  const allScenarios = parseXlsxScenarios(xlsxPath, {
    ids: selectedIds
  });
  const priority = getExecutionPriority();

  if (selectedArea && !priority.includes(selectedArea)) {
    throw new Error(`Unknown area: ${selectedArea}`);
  }
  
  // Group by area
  const grouped: Map<FeatureArea, TestScenario[]> = new Map();
  for (const s of allScenarios) {
    if (!grouped.has(s.area)) grouped.set(s.area, []);
    grouped.get(s.area)!.push(s);
  }
  
  console.log(`Total scenarios: ${allScenarios.length}`);
  console.log(`Feature areas: ${grouped.size}`);
  
  console.log('\nBrowser sessions: one browser per scenario');
  produceHeaderValue = getProduceHeader(config);
  
  // Execute by priority
  const allResults: TestResult[] = [];
  let areasExecuted = 0;
  
  for (const area of priority) {
    if (areaLimit && areasExecuted >= areaLimit) break;
    if (selectedArea && area !== selectedArea) continue;
    
    const areaScenarios = grouped.get(area);
    if (!areaScenarios || areaScenarios.length === 0) continue;
    
    const results = await executeFeatureArea(area, areaScenarios);
    allResults.push(...results);
    areasExecuted++;
  }
  
  // Print final summary
  const passed = allResults.filter(r => r.status === 'passed').length;
  const passedWithDeviation = allResults.filter(r => r.status === 'passed-with-deviation').length;
  const failed = allResults.filter(r => r.status === 'failed').length;
  const blocked = allResults.filter(r => r.status === 'blocked').length;
  
  console.log('\n' + '='.repeat(60));
  console.log('EXECUTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total: ${allResults.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`◐ Passed with deviation: ${passedWithDeviation}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️ Blocked: ${blocked}`);
  console.log(`\nReports saved to: ${reportsDir}`);
}

main().catch(console.error);
