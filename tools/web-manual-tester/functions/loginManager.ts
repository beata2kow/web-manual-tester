import { EnvironmentConfig } from './readConfig';
import { UserWithCapabilities } from './getAvailableUsers';

export interface LoginPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  locator(selector: string): LoginLocator;
  waitForLoadState(state?: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
}

export interface LoginLocator {
  first(): LoginLocator;
  nth(index: number): LoginLocator;
  count(): Promise<number>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  fill(value: string): Promise<void>;
  click(options?: { force?: boolean }): Promise<void>;
  textContent(): Promise<string | null>;
}

export interface LoginBrowserContext {
  clearCookies(): Promise<void>;
  clearPermissions(): Promise<void>;
}

export interface LoginManagerDeps {
  page: LoginPage;
  context: LoginBrowserContext;
  config: EnvironmentConfig;
  sleep: (ms: number) => Promise<void>;
  locatorAnyVisible: (
    selectors: string[],
    timeout?: number
  ) => Promise<{ click(options?: { force?: boolean }): Promise<void> } | null>;
}

export class LoginManager {
  currentUser: UserWithCapabilities | null = null;
  availableContexts: string[] = [];
  currentContextIndex = 0;
  currentContextName = '';

  constructor(private readonly deps: LoginManagerDeps) {}

  async isOnLoginPage(): Promise<boolean> {
    const url = this.deps.page.url();
    return url.includes('auth') || url.includes('login') || url.includes('realms') || url.includes('select-context');
  }

  async login(user: UserWithCapabilities, options: { force?: boolean } = {}): Promise<boolean> {
    console.log(`  Logging in as: ${user.username}`);
    this.availableContexts = [];
    this.currentContextIndex = 0;

    await this.deps.page.goto(this.deps.config.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await this.deps.sleep(2000);

    const onLoginPage = await this.isOnLoginPage();
    if (!onLoginPage && !options.force) {
      const pageContent = await this.deps.page.content();
      if (!pageContent.includes('access denied') && !pageContent.includes('RBAC')) {
        if (this.currentUser?.username === user.username) {
          console.log(`    Already logged in as ${user.username}`);
          return true;
        }
        console.log(`    Session is ${this.currentUser?.username || 'unknown'}, re-authenticating as ${user.username}`);
        await this.logout();
        await this.deps.page.goto(this.deps.config.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await this.deps.sleep(2000);
      }
    } else if (!onLoginPage && options.force) {
      await this.logout();
      await this.deps.page.goto(this.deps.config.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await this.deps.sleep(2000);
    }

    this.currentUser = user;

    const usernameSelector = '#identity-web-auth-usernamethenpassword-username-username-input';
    const nextButtonSelector = '#identity-web-auth-usernamethenpassword-username-submit-button_load-button';
    const passwordSelector = '#identity-web-auth-usernamethenpassword-password-password-input';
    const submitButtonSelector = '#identity-web-auth-usernamethenpassword-password-submit-button_load-button';

    try {
      const usernameInput = this.deps.page.locator(usernameSelector);

      if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await usernameInput.fill(user.username);
        await this.deps.page.locator(nextButtonSelector).click();
        await this.deps.sleep(2000);

        await this.deps.page.waitForSelector(passwordSelector, { timeout: 10000 });
        await this.deps.page.locator(passwordSelector).fill(user.password);
        await this.deps.page.locator(submitButtonSelector).click();
        await this.deps.sleep(3000);
      }
    } catch (error) {
      console.log(`    Login form error: ${error}`);
      return false;
    }

    await this.deps.page.waitForLoadState('networkidle');
    let newUrl = this.deps.page.url();

    if (newUrl.includes('select-context')) {
      console.log('    Context selection page detected');
      const contextHeader = this.deps.page.locator('[data-role="select-context-header"]');
      if (await contextHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
        const contextElements = this.deps.page.locator('[data-role="market-stall-item-name"]');
        const count = await contextElements.count();
        this.availableContexts = [];
        for (let index = 0; index < count; index++) {
          const name = await contextElements.nth(index).textContent();
          if (name) {
            this.availableContexts.push(name.trim());
          }
        }
        console.log(`    Available contexts: ${this.availableContexts.length}`);

        this.currentContextIndex = 0;
        const firstContext = contextElements.first();
        this.currentContextName = (await firstContext.textContent())?.trim() || '';
        console.log(`    Selecting: ${this.currentContextName}`);
        await firstContext.click({ force: true });
        await this.deps.sleep(3000);
        await this.deps.page.waitForLoadState('networkidle');
      }
    }

    newUrl = this.deps.page.url();
    const success =
      !newUrl.includes('auth') &&
      !newUrl.includes('login') &&
      !newUrl.includes('realms') &&
      !newUrl.includes('select-context');
    console.log(`    Login ${success ? 'successful' : 'failed'}`);
    return success;
  }

  async logout(): Promise<void> {
    try {
      const userMenuRoot = this.deps.page.locator('[data-role="user-context-menu-widget"]').first();
      if (await userMenuRoot.isVisible({ timeout: 2000 }).catch(() => false)) {
        const menuToggle = userMenuRoot.locator('.user-context-dropdown__toggle').first();
        if (await menuToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
          await menuToggle.click({ force: true });
        } else {
          await userMenuRoot.click({ force: true });
        }
        await this.deps.sleep(500);

        const logoutBtn = userMenuRoot.locator('[data-role="logout"]').first();
        if (await logoutBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await logoutBtn.click({ force: true });
          await this.deps.sleep(3000);
        } else {
          const fallbackLogout = await this.deps.locatorAnyVisible(
            [
              '[data-role="logout"]',
              'text=Log out',
              'text=Sign out',
              'button:has-text("Log out")',
              'button:has-text("Sign out")'
            ],
            1500
          );
          if (fallbackLogout) {
            await fallbackLogout.click({ force: true });
            await this.deps.sleep(3000);
          }
        }
      }

      await this.deps.context.clearCookies();
      await this.deps.context.clearPermissions().catch(() => {});
      await this.deps.page.goto(this.deps.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await this.deps.sleep(1500);
    } catch (error) {
      console.log(`    Logout error: ${error}`);
      await this.deps.context.clearCookies().catch(() => {});
    }

    this.currentUser = null;
    this.availableContexts = [];
    this.currentContextIndex = 0;
    this.currentContextName = '';
  }

  async switchToNextContext(): Promise<boolean> {
    if (this.availableContexts.length <= 1) {
      return false;
    }

    this.currentContextIndex++;
    if (this.currentContextIndex >= this.availableContexts.length) {
      return false;
    }

    const nextContext = this.availableContexts[this.currentContextIndex];
    console.log(`    Switching to context: ${nextContext}`);

    try {
      const userMenu = this.deps.page.locator('[data-role="user-context-menu-widget"]').first();
      if (await userMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await userMenu.click();
        await this.deps.sleep(500);

        const switchOption = this.deps.page.locator('text="Switch context"').first();
        if (await switchOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await switchOption.click();
          await this.deps.sleep(1000);

          const contextItem = this.deps.page.locator(`text="${nextContext}"`).first();
          if (await contextItem.isVisible({ timeout: 3000 }).catch(() => false)) {
            await contextItem.click({ force: true });
            await this.deps.sleep(3000);
            await this.deps.page.waitForLoadState('networkidle');
            this.currentContextName = nextContext;
            console.log(`    Switched to: ${nextContext}`);
            return true;
          }
        }
      }
    } catch (error) {
      console.log(`    Context switch failed: ${error}`);
    }

    return false;
  }

  resetSessionState(): void {
    this.currentUser = null;
    this.availableContexts = [];
    this.currentContextIndex = 0;
    this.currentContextName = '';
  }
}
