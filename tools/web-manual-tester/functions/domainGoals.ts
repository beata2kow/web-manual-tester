import { GoalVerificationResult } from './goalVerification';
import { TestScenario } from './parseXlsxScenarios';
import { StepExecutorDeps } from './stepExecutorTypes';

async function urlMatches(deps: StepExecutorDeps, pattern: RegExp): Promise<boolean> {
  return pattern.test(deps.page.url());
}

export async function verifyDomainGoal(
  text: string,
  scenario: TestScenario,
  deps: StepExecutorDeps
): Promise<GoalVerificationResult | null> {
  const area = scenario.area;

  if (area === 'growers' || /grower\s+list/i.test(text)) {
    if (/grower\s+list\s+is\s+displayed/i.test(text)) {
      const visible = Boolean(
        await deps.locatorAnyVisible(
          ['app-grower-manager-list', 'app-growers-journey', 'table tbody tr', '[data-role="grower-list"]'],
          5000
        )
      );
      return visible
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Grower list not visible' };
    }
    if (/netherlands.*(?:selected|default)/i.test(text) || /market\s+branch\s+code/i.test(text)) {
      const field = Boolean(
        await deps.locatorAnyVisible(
          ['[data-role*="country"]', 'text=Netherlands', '[data-role="market-branch"]', 'input[data-role*="branch"]'],
          4000
        )
      );
      return field
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Expected market/country field not visible in grower form' };
    }
  }

  if (area === 'orders' || /order\s+order|order\s+template/i.test(text)) {
    if (/list\s+of\s+submitted\s+order|order\s+orders?/i.test(text)) {
      const list = Boolean(
        await deps.locatorAnyVisible(
          ['app-manage-orders-list', 'app-orders-list', 'table tbody tr', '[data-role="order-list"]'],
          5000
        )
      );
      return list
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Order tickets list not visible' };
    }
    if (/approve.*reject|buttons?\s+['"]?approve/i.test(text)) {
      const actions = Boolean(
        await deps.locatorAnyVisible(
          ['button:has-text("Approve")', 'button:has-text("Reject")', '[data-role="approve-button"]'],
          4000
        )
      );
      return actions
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'blocked', note: 'Approve/Reject actions not visible — may need pending orders' };
    }
    if (/more\s+options|ellipsis|\(\.\.\.\)/i.test(text) && /edit|delete|cancel/i.test(text)) {
      const menu = Boolean(
        await deps.locatorAnyVisible(
          ['[data-role="more-options"]', '[data-role="more-actions"]', 'button[aria-label*="more"]', 'button:has-text("...")'],
          4000
        )
      );
      return menu
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'More options menu not found' };
    }
    if (/saved\s+order\s+templates?|new\s+templates?/i.test(text)) {
      const templates = Boolean(
        await deps.locatorAnyVisible(['app-templates-list', 'text=Templates', 'button:has-text("New Template")'], 4000)
      );
      return templates
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Order templates UI not visible' };
    }
  }

  if (area === 'dashboard' || /dashboard|quick\s+actions?|custom\s+tile/i.test(text)) {
    if (/dropdown\s+menu/i.test(text) && /quick\s+actions?/i.test(text)) {
      const menu = Boolean(
        await deps.locatorAnyVisible(['[role="menu"]', '.dropdown-menu.show', 'app-dropdown-panel'], 3000)
      );
      return menu
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Quick actions dropdown not open' };
    }
    if (/custom\s+(?:quick\s+actions?\s+)?button|custom\s+tile/i.test(text)) {
      const custom = Boolean(
        await deps.locatorAnyVisible(
          ['[data-role="customize"]', 'button:has-text("Customize")', 'text=Customize', '[data-role="widget"]'],
          4000
        )
      );
      return custom
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Dashboard customize affordance not visible' };
    }
    if (/cherry\s+tile.*(?:1st|first)\s+position/i.test(text)) {
      const tile = Boolean(await deps.locatorAnyVisible(['[data-role="dashboard-tile"]', '.app-dashboard-widget', 'app-tile'], 3000));
      return tile
        ? { ok: true, status: 'passed-with-deviation', note: 'Dashboard tiles visible; exact position not asserted' }
        : { ok: false, status: 'failed', note: 'Dashboard tiles not visible' };
    }
  }

  if (area === 'cherries' || /cherries?\s+list|cherry\s+details/i.test(text)) {
    if (/redirected\s+to.*cherries?\s+list/i.test(text) || /all\s+user'?s?\s+cherries/i.test(text)) {
      const cherries = Boolean(
        await deps.locatorAnyVisible(
          ['app-cherry-manager', '[data-role="cherry-list"]', 'text=Physical', 'text=Virtual', 'table tbody tr'],
          5000
        )
      );
      return cherries
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Cherries list not visible' };
    }
    if (/redirected\s+to\s+cherry\s+details/i.test(text)) {
      const details = Boolean(
        await deps.locatorAnyVisible(['app-cherry-details', '[data-role="cherry-details"]', 'app-cherry-detail-view'], 5000)
      );
      return details
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Cherry details view not visible' };
    }
  }

  if (area === 'explore-products' || /product\s+categor|product\s+cherries?/i.test(text)) {
    if (/product\s+categor|first-level\s+product/i.test(text)) {
      const catalog = Boolean(
        await deps.locatorAnyVisible(
          ['app-product-catalog', '[data-role="product-category"]', '.product-category', 'app-explore-products'],
          5000
        )
      );
      return catalog
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Product catalog/categories not visible' };
    }
    if (/product\s+cherries?|detailed\s+view\s+of\s+the\s+selected\s+product/i.test(text)) {
      const cherries = Boolean(
        await deps.locatorAnyVisible(['app-product-cherry', '[data-role="product-cherry"]', 'app-product-details'], 5000)
      );
      return cherries
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Product cherries/detail view not visible' };
    }
  }

  if (area === 'barter' || /forwards?|variety\s+rates?|favorite\s+variety/i.test(text)) {
    if (/list\s+of\s+available\s+forwards?/i.test(text)) {
      const forwards = Boolean(
        await deps.locatorAnyVisible(['app-barter-forwards', 'table tbody tr', '[data-role="forwards-list"]', 'text=Forward'], 5000)
      );
      return forwards
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'blocked', note: 'Forwards list empty or journey not loaded' };
    }
    if (/variety\s+rates?|carousel/i.test(text)) {
      const rates = Boolean(
        await deps.locatorAnyVisible(['app-variety-carousel', '[data-role="bx-rates"]', '.carousel', 'app-bx-rates'], 5000)
      );
      return rates
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Variety rates carousel not visible' };
    }
    if (/total\s+stocks?\s+by\s+variety/i.test(text)) {
      const tile = Boolean(await deps.locatorAnyVisible(['app-baskets-tile', '[data-role="baskets-tile"]'], 4000));
      return tile
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Baskets tile stocks not visible' };
    }
  }

  if (area === 'baskets' || /baskets?\s+journey|favourites?|favorites?/i.test(text)) {
    if (/redirected\s+to\s+baskets?\s+journey/i.test(text)) {
      const onBaskets = (await urlMatches(deps, /\/my-baskets|\/baskets/)) ||
        Boolean(await deps.locatorAnyVisible(['app-baskets-list', 'app-basket-details'], 4000));
      return onBaskets
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Not on Baskets journey' };
    }
    if (/redirected\s+to\s+pickings?\s+journey/i.test(text)) {
      const onTx = (await urlMatches(deps, /\/pickings/)) ||
        Boolean(await deps.locatorAnyVisible(['app-pickings-list', 'app-pickings-table'], 4000));
      return onTx
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Not on Pickings journey' };
    }
    if (/favourites?|favorites?/i.test(text)) {
      const fav = Boolean(
        await deps.locatorAnyVisible(['text=Favourites', 'text=Favorites', '[data-role="favorites"]'], 4000)
      );
      return fav
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Favourites section not visible' };
    }
    if (/pickings?\s+for\s+selected/i.test(text)) {
      const tx = Boolean(await deps.locatorAnyVisible(['table tbody tr', 'app-pickings-list'], 4000));
      return tx
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Pickings list not visible' };
    }
    if (/searched\s+basket/i.test(text)) {
      const results = Boolean(await deps.locatorAnyVisible(['app-search-results', 'table tbody tr'], 3000));
      return results
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Search results not visible' };
    }
  }

  if (area === 'standing-crates' || /direct\s+outflow/i.test(text)) {
    if (/direct\s+outflow\s+details/i.test(text)) {
      const details = Boolean(
        await deps.locatorAnyVisible(['app-standing-crate-details', '[data-role="standing-crate-details"]', 'app-crate-manager-list'], 5000)
      );
      return details
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Standing crate details not visible' };
    }
    if (/direct\s+outflow\s+reversal/i.test(text)) {
      const reversal = Boolean(
        await deps.locatorAnyVisible(['text=Standing crate reversal', 'text=Reversal', '[data-role="reversal"]'], 5000)
      );
      return reversal
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Standing crate reversal view not visible' };
    }
  }

  if (area === 'banners' || /engagement\s+banner|carousel/i.test(text)) {
    if (/engagement\s+banner\s+carousel/i.test(text)) {
      const carousel = Boolean(
        await deps.locatorAnyVisible(['app-engagement-banner', '.carousel', '[data-role="engagement-banner"]'], 5000)
      );
      return carousel
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Engagement banner carousel not visible' };
    }
  }

  if (area === 'authentication' || /terms\s+and\s+conditions|login&security|switch\s+context/i.test(text)) {
    if (/terms\s+and\s+conditions/i.test(text)) {
      const tnc = Boolean(await deps.locatorAnyVisible(['text=Terms and Conditions', 'app-terms-and-conditions'], 4000));
      return tnc
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'passed-with-deviation', note: 'T&C page not shown — user may have already accepted' };
    }
    if (/login&security|login\s+and\s+security/i.test(text)) {
      const tab = Boolean(await deps.locatorAnyVisible(['text=Login', 'text=Security', '[data-role="login-security"]'], 4000));
      return tab
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Login & Security section not visible' };
    }
    if (/switch\s+context\s+menu/i.test(text)) {
      const item = Boolean(await deps.locatorAnyVisible(['text=Switch context', '[data-role="switch-context"]'], 4000));
      return item
        ? { ok: true, status: 'passed', note: '' }
        : { ok: false, status: 'failed', note: 'Switch Context menu item not visible' };
    }
  }

  return null;
}
