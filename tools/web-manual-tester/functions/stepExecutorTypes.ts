import { TestScenario } from './parseXlsxScenarios';

export interface StepExecutorPage {
  locator(selector: string): {
    first(): StepLocator;
    count(): Promise<number>;
    nth(index: number): { first(): StepLocator };
  };
  url(): string;
  waitForLoadState(state?: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  content(): Promise<string>;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  reload(): Promise<unknown>;
}

export interface StepLocator {
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  click(options?: { force?: boolean }): Promise<void>;
  waitFor(options: { state: 'visible' | 'hidden'; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<unknown>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  fill(value: string): Promise<void>;
  selectOption(value: string | { label: string }): Promise<void>;
}

export interface MenuPath {
  section?: string;
  items: string[];
}

export interface NavigationTarget {
  menuPaths: MenuPath[];
  directUrls?: string[];
}

export interface StepExecutorDeps {
  page: StepExecutorPage;
  sleep: (ms: number) => Promise<void>;
  dismissBlockingModals: () => Promise<void>;
  locatorAnyVisible: (selectors: string[], timeout?: number) => Promise<{ isVisible(options?: { timeout?: number }): Promise<boolean>; click(options?: { force?: boolean }): Promise<void> } | null>;
  navigateToMenu: (menuPath: MenuPath) => Promise<boolean>;
  navigateToDirectUrl: (directUrls: string[]) => Promise<boolean>;
  getNavigationTargetForScenario: (scenario: TestScenario) => NavigationTarget;
  clickAppMenuItem: (itemName: string, sectionName?: string) => Promise<boolean>;
  repoRoot?: string;
  userEmail?: string;
  handleOtpFlow?: (userEmail: string) => Promise<boolean>;
  uploadFixture?: (filePath: string) => Promise<boolean>;
  /** When true, skip heuristic fallbacks — only exact menu/quoted-text clicks. */
  strictMode?: boolean;
}
