import { StepExecutorDeps } from './stepExecutorTypes';

const DEFAULT_GROWER_NAME = 'Manual Test Grower';

export async function tryFormActionFromText(text: string, deps: StepExecutorDeps): Promise<boolean> {
  if (/enters?\s+the\s+amount/i.test(text)) {
    const amountField = await deps.locatorAnyVisible(
      [
        'input[data-role*="amount"]',
        'input[name*="amount"]',
        'app-amount-input-ui input',
        'app-order-amount input',
        '[data-role="order-amount"] input'
      ],
      4000
    );
    if (amountField) {
      await amountField.fill('10.00');
      await deps.sleep(500);
      console.log('    Filled amount: 10.00');
      return true;
    }
  }

  if (/selects?\s+(?:a\s+)?seedling\s+basket/i.test(text)) {
    const seedlingRow = await deps.locatorAnyVisible(
      [
        'app-product-selector-list [data-role="list-item"]:has-text("Seedling")',
        'table tbody tr:has-text("Seedling")',
        '[data-role="basket-list-item"]:has-text("Seedling")',
        'text=Seedling'
      ],
      4000
    );
    if (seedlingRow) {
      await seedlingRow.click({ force: true });
      await deps.sleep(1000);
      console.log('    Selected seedling basket');
      return true;
    }
  }

  if (/selects?\s+(?:an?\s+)?(?:fresh|ripe|stored)\s+basket/i.test(text)) {
    const type = /fresh/i.test(text) ? 'Fresh' : /stored/i.test(text) ? 'Stored' : '';
    const selectors = type
      ? [`table tbody tr:has-text("${type}")`, `[data-role="list-item"]:has-text("${type}")`, `text=${type}`]
      : ['table tbody tr', '[data-role="basket-list-item"]', 'app-product-selector-list [data-role="list-item"]'];
    const basket = await deps.locatorAnyVisible(selectors, 4000);
    if (basket) {
      await basket.click({ force: true });
      await deps.sleep(1000);
      console.log(`    Selected basket${type ? `: ${type}` : ''}`);
      return true;
    }
  }

  if (/selects?\s+(?:an?\s+)?basket/i.test(text) || /selects?\s+random\s+basket/i.test(text)) {
    const basket = await deps.locatorAnyVisible(
      [
        'table tbody tr',
        '[data-role="basket-list-item"]',
        'app-product-selector-list [data-role="list-item"]',
        '[data-role="list-item"]'
      ],
      4000
    );
    if (basket) {
      await basket.click({ force: true });
      await deps.sleep(1000);
      console.log('    Selected basket from list');
      return true;
    }
  }

  if (/input\s+correct\s+name/i.test(text)) {
    const nameField = await deps.locatorAnyVisible(
      [
        'input[data-role*="name"]',
        'input[name*="name"]',
        '[data-role="grower-name"] input',
        'app-input-text-ui input'
      ],
      4000
    );
    if (nameField) {
      await nameField.fill(DEFAULT_GROWER_NAME);
      await deps.sleep(500);
      console.log(`    Filled grower name: ${DEFAULT_GROWER_NAME}`);
      return true;
    }
  }

  if (/selects?\s+['"]?netherlands['"]?\s+country/i.test(text)) {
    const country = await deps.locatorAnyVisible(
      [
        'select[data-role*="country"]',
        '[data-role="country"] select',
        'app-dropdown-single-select:has-text("Netherlands")',
        'text=Netherlands'
      ],
      4000
    );
    if (country) {
      await country.click({ force: true });
      await deps.sleep(800);
      console.log('    Selected Netherlands country');
      return true;
    }
  }

  if (/exclude\s+header\s+row/i.test(text)) {
    const checkbox = await deps.locatorAnyVisible(
      ['input[type="checkbox"]:near(:text("Exclude header"))', 'label:has-text("Exclude header") input'],
      3000
    );
    if (checkbox) {
      await checkbox.click({ force: true });
      await deps.sleep(500);
      console.log('    Toggled Exclude header row');
      return true;
    }
  }

  if (/sets?\s+desired\s+time\s+range|date\s+selector/i.test(text)) {
    const dateRange = await deps.locatorAnyVisible(['[data-role="date-range"]', 'app-date-range-input'], 3000);
    if (dateRange) {
      console.log('    Date range control visible (manual date selection assumed)');
      return true;
    }
  }

  if (/adds?\s+or\s+removes?\s+.*variety\s+pairs?/i.test(text) || /removes?\s+all\s+variety\s+pairs/i.test(text)) {
    const favControl = await deps.locatorAnyVisible(
      ['app-favorite-variety-pairs', '[data-role="favorite-variety"]', 'button:has-text("Add")'],
      3000
    );
    if (favControl) {
      console.log('    Favorite variety pairs UI visible');
      return true;
    }
  }

  return false;
}
