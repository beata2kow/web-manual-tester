#!/usr/bin/env npx ts-node
/**
 * Parse XLSX test scenarios file and categorize by feature area
 * Usage: npx ts-node libs/memory/agents/functions/parseXlsxScenarios.ts [xlsx-path] [--area <area>] [--ids <id1,id2>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { requireRepoModule, resolveDefaultWorkbookPath, resolveRepoRoot } from './resolveRepoModule';

function getXlsx(): typeof import('xlsx') {
  return requireRepoModule<typeof import('xlsx')>('xlsx');
}

export interface TestStep {
  stepNumber: string;
  action: string;
  expectedResult: string;
}

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  area: FeatureArea;
  steps: TestStep[];
  tags: {
    webAutomated: boolean;
    webManual: boolean;
  };
  usesMailosaur: boolean;
  actionType: ActionType;
}

export type ActionType = 'view' | 'create' | 'edit' | 'approve' | 'reject' | 'cancel' | 'delete' | 'other';

export type FeatureArea =
  | 'audit'
  | 'authentication'
  | 'baskets'
  | 'pickings'
  | 'harvest-logs'
  | 'banners'
  | 'crates'
  | 'cherries'
  | 'growers'
  | 'dashboard'
  | 'explore-products'
  | 'standing-crates'
  | 'barter'
  | 'seedlings'
  | 'messages'
  | 'notifications'
  | 'orders'
  | 'self-service-seedlings'
  | 'user-profile'
  | 'user-profile-otp'
  | 'wholesale'
  | 'user-management'
  | 'unknown';

const AREA_KEYWORDS: Record<FeatureArea, string[]> = {
  'audit': ['audit'],
  'authentication': ['log in', 'login', 'password', 'username', 'context', 'forgotten'],
  'baskets': ['basket', 'stock', 'alias', 'favorite', 'mask', 'unmask'],
  'pickings': ['picking', 'quick filter', 'export pickings'],
  'harvest-logs': ['harvest-log', 'harvest log'],
  'banners': ['banner', 'maintenance'],
  'crates': ['crate', 'file upload'],
  'cherries': ['cherry', 'stone', 'trip notice', 'vending-stall', 'basket limit'],
  'growers': ['grower', 'grower'],
  'dashboard': ['dashboard', 'tile', 'quick action', 'widget'],
  'explore-products': [
    'explore product',
    'product catalog',
    'product categor',
    'sub categor',
    'apply for product',
    'product benefits',
    'cta that can be configured'
  ],
  'standing-crates': ['standing crate'],
  'barter': ['barter', 'forward', 'variety', 'bx'],
  'seedlings': ['seedling', 'cold-storage', 'ripening-schedule'],
  'messages': ['message', 'inbox', 'outbox', 'conversation', 'draft'],
  'notifications': ['notification'],
  'orders': [
    'order ticket',
    'order template',
    'manage templates',
    'saved order template',
    'initiate standard',
    'initiate international',
    'initiate order',
    'standard delivery',
    'express delivery',
    'approve order',
    'reject order',
    'cancel a order',
    'manage order',
    'new order',
    'express delivery',
    'barter contract'
  ],
  'self-service-seedlings': ['application', 'unsecured', 'secured', 'supply line', 'seasonal seedling'],
  'user-profile': ['profile', 'language', 'phone number', 'email address', 'address'],
  'user-profile-otp': ['otp via email', 'otp via sms', 'change password', 'device'],
  'wholesale': ['letter of supply', 'import lc', 'lc application'],
  'user-management': ['admin', 'user management', 'session', 'unlock', 'lock user', 'reset'],
  'unknown': []
};

const OTP_KEYWORDS = ['otp', 'freshness check', 'authorisation', 'authorization', 'approve', 'reject', '2fa', 'mailosaur', 'email me a code', 'text me a code'];

const ACTION_TYPE_PATTERNS: Record<ActionType, RegExp[]> = {
  'view': [/^view/i, /^list/i, /^see/i, /^display/i, /^retrieve/i, /^search/i, /^filter/i],
  'create': [/^create/i, /^add/i, /^new/i, /^initiate/i, /^submit/i, /^compose/i, /^order/i, /^upload/i],
  'edit': [/^edit/i, /^modify/i, /^update/i, /^change/i, /^set/i, /^manage/i],
  'approve': [/approve/i, /^accept/i],
  'reject': [/reject/i, /^decline/i],
  'cancel': [/cancel/i, /^block/i, /^suspend/i],
  'delete': [/delete/i, /^remove/i, /^restore/i],
  'other': []
};

// Priority order for area detection - more specific areas first
const AREA_DETECTION_PRIORITY: FeatureArea[] = [
  'messages',           // Check "message", "conversation" before generic keywords
  'standing-crates',      // "standing crate" before "outflow"
  'harvest-logs', // "harvest log" before "basket"
  'self-service-seedlings', // Specific seedling types before "seedling"
  'user-profile-otp',   // "change password" before "password"
  'user-management',    // "user management" before "user"
  'wholesale',
  'explore-products',
  'crates',
  'cherries',
  'growers',
  'orders',
  'barter',
  'seedlings',
  'baskets',
  'pickings',
  'dashboard',
  'banners',
  'notifications',
  'audit',
  'user-profile',
  'authentication',     // Check authentication LAST (has generic keywords like "password", "context")
];

function detectFeatureArea(scenarioName: string, description: string): FeatureArea {
  const searchText = `${scenarioName} ${description}`.toLowerCase();

  if (
    /product categor|explore product|apply for product|product catalog|sub categor/i.test(searchText) ||
    /benefits and a brief description/i.test(searchText) ||
    /cta that can be configured at a template level/i.test(searchText) ||
    (/display up to \d+ benefits/i.test(searchText) && /product/i.test(searchText))
  ) {
    return 'explore-products';
  }

  if (/grower.*\.csv|csv file upload to create a grower|grower manager page/i.test(searchText)) {
    return 'growers';
  }

  if (
    /grouped|favourites and product kinds|single group view|arrangement view|aggregated stocks on product kind/i.test(
      searchText
    ) &&
    !/order|delivery|standard|express|crate/i.test(searchText)
  ) {
    return 'baskets';
  }

  if (
    /order template|manage templates|saved order template|order ticket|initiate standard|initiate international|manual order|manageorder/i.test(
      searchText
    )
  ) {
    return 'orders';
  }

  // Check areas in priority order
  for (const area of AREA_DETECTION_PRIORITY) {
    const keywords = AREA_KEYWORDS[area];
    if (!keywords) continue;
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return area;
      }
    }
  }
  return 'unknown';
}

function detectActionType(scenarioName: string): ActionType {
  for (const [actionType, patterns] of Object.entries(ACTION_TYPE_PATTERNS)) {
    if (actionType === 'other') continue;
    for (const pattern of patterns) {
      if (pattern.test(scenarioName)) {
        return actionType as ActionType;
      }
    }
  }
  return 'other';
}

function detectMailosaurUsage(scenarioName: string, steps: TestStep[]): boolean {
  const allText = `${scenarioName} ${steps.map(s => `${s.action} ${s.expectedResult}`).join(' ')}`.toLowerCase();
  return OTP_KEYWORDS.some(keyword => allText.includes(keyword.toLowerCase()));
}

export function parseXlsxScenarios(
  xlsxPath: string,
  options?: { area?: FeatureArea; ids?: string[] }
): TestScenario[] {
  const XLSX = getXlsx();
  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Fix incorrect sheet range - some Excel files have wrong !ref metadata
  let maxRow = 0;
  let maxCol = 0;
  for (const cell in sheet) {
    if (cell[0] === '!') continue;
    const match = cell.match(/([A-Z]+)(\d+)/);
    if (match) {
      const col = XLSX.utils.decode_col(match[1]);
      const row = parseInt(match[2], 10);
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    }
  }
  if (maxRow > 0) {
    sheet['!ref'] = `A1:${XLSX.utils.encode_col(maxCol)}${maxRow}`;
  }
  
  const rows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, { 
    header: 1,
    defval: '',
    raw: false
  });

  const scenarios: TestScenario[] = [];
  let currentScenario: Partial<TestScenario> | null = null;
  let currentSteps: TestStep[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();
    const col2 = String(row[2] || '').trim();
    const col3 = String(row[3] || '').trim();
    const col4 = String(row[4] || '').trim();

    if (col0 === 'undefined' && col1) {
      if (currentScenario && currentScenario.name) {
        currentScenario.steps = currentSteps;
        currentScenario.usesMailosaur = detectMailosaurUsage(currentScenario.name, currentSteps);
        scenarios.push(currentScenario as TestScenario);
      }
      
      currentScenario = {
        id: '',
        name: col1,
        description: '',
        area: 'unknown',
        steps: [],
        tags: { webAutomated: false, webManual: false },
        usesMailosaur: false,
        actionType: detectActionType(col1)
      };
      currentSteps = [];
      continue;
    }

    if (col0 === 'Description' && currentScenario) {
      currentScenario.description = col1;
      continue;
    }

    if (/^\d{8}$/.test(col0) && currentScenario) {
      currentScenario.id = col0;
      currentScenario.area = detectFeatureArea(currentScenario.name || '', currentScenario.description || '');
      continue;
    }

    if (/^\d+\)$/.test(col0) && currentScenario) {
      const stepNumber = col0.replace(')', '');
      const action = col1;
      const expectedResult = col2;
      
      if (col3 === 'web-automated') {
        currentScenario.tags!.webAutomated = true;
      }
      if (col4 === 'web-manual') {
        currentScenario.tags!.webManual = true;
      }
      
      if (action || expectedResult) {
        currentSteps.push({
          stepNumber,
          action: action || '',
          expectedResult: expectedResult || ''
        });
      }
      continue;
    }
  }

  if (currentScenario && currentScenario.name) {
    currentScenario.steps = currentSteps;
    currentScenario.usesMailosaur = detectMailosaurUsage(currentScenario.name, currentSteps);
    scenarios.push(currentScenario as TestScenario);
  }

  let filteredScenarios = scenarios.filter(s => s.id);

  if (options?.area) {
    filteredScenarios = filteredScenarios.filter(s => s.area === options.area);
  }

  if (options?.ids && options.ids.length > 0) {
    filteredScenarios = filteredScenarios.filter(s => options.ids!.includes(s.id));
  }

  return filteredScenarios;
}

export function groupScenariosByArea(scenarios: TestScenario[]): Record<FeatureArea, TestScenario[]> {
  const grouped: Record<FeatureArea, TestScenario[]> = {} as Record<FeatureArea, TestScenario[]>;
  
  for (const scenario of scenarios) {
    if (!grouped[scenario.area]) {
      grouped[scenario.area] = [];
    }
    grouped[scenario.area].push(scenario);
  }
  
  return grouped;
}

export function getExecutionPriority(): FeatureArea[] {
  return [
    'crates',
    'standing-crates',
    'orders',
    'audit',
    'authentication',
    'baskets',
    'pickings',
    'harvest-logs',
    'banners',
    'cherries',
    'growers',
    'dashboard',
    'explore-products',
    'barter',
    'seedlings',
    'messages',
    'notifications',
    'self-service-seedlings',
    'wholesale',
    'user-management',
    'user-profile-otp',
    'user-profile',
    'unknown'
  ];
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoRoot = resolveRepoRoot(args);
  const positionalWorkbook = args.find(arg => !arg.startsWith('--') && arg.toLowerCase().endsWith('.xlsx'));
  const xlsxPath = positionalWorkbook
    ? (path.isAbsolute(positionalWorkbook) ? positionalWorkbook : path.join(repoRoot, positionalWorkbook))
    : resolveDefaultWorkbookPath(repoRoot);
  
  let filterArea: FeatureArea | undefined;
  let filterIds: string[] | undefined;
  
  const areaIndex = args.indexOf('--area');
  if (areaIndex !== -1 && args[areaIndex + 1]) {
    filterArea = args[areaIndex + 1] as FeatureArea;
  }
  
  const idsIndex = args.indexOf('--ids');
  if (idsIndex !== -1 && args[idsIndex + 1]) {
    filterIds = args[idsIndex + 1].split(',');
  }
  
  try {
    const scenarios = parseXlsxScenarios(xlsxPath, { area: filterArea, ids: filterIds });
    const grouped = groupScenariosByArea(scenarios);
    
    console.log('=== Parsed Test Scenarios ===\n');
    console.log(`Total scenarios: ${scenarios.length}\n`);
    
    console.log('By feature area:');
    for (const [area, areaScenarios] of Object.entries(grouped)) {
      console.log(`  ${area}: ${areaScenarios.length}`);
    }
    
    console.log('\n=== Scenarios (JSON) ===');
    console.log(JSON.stringify(scenarios, null, 2));
  } catch (error) {
    console.error('Error parsing XLSX:', error);
    process.exit(1);
  }
}
