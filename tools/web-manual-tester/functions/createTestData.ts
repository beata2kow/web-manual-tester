#!/usr/bin/env npx ts-node
/**
 * Create test data via API for scenarios that require preconditions
 * Usage: npx ts-node libs/memory/agents/functions/createTestData.ts <data-type> [options]
 * 
 * Supported data types:
 *   - crate: Create a crate order in Entered status
 *   - grower: Create a grower
 *   - order: Create a order ticket
 *   - standing-crate: Create a standing crate crate
 */

import * as https from 'https';
import * as http from 'http';
import { readConfig, EnvironmentConfig } from './readConfig';
import { getAvailableUsers, UserWithCapabilities } from './getAvailableUsers';

interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: object;
  headers?: Record<string, string>;
}

export interface TestDataResult {
  success: boolean;
  type: string;
  id?: string;
  data?: object;
  error?: string;
}

async function makeApiRequest(
  baseUrl: string,
  options: ApiRequestOptions,
  authToken?: string
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers
    };
    
    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        let body: unknown;
        try {
          body = data ? JSON.parse(data) : null;
        } catch {
          body = data;
        }
        
        resolve({ statusCode: res.statusCode || 0, body });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

export async function authenticateUser(
  config: EnvironmentConfig,
  username: string,
  password: string
): Promise<string> {
  console.log(`Authenticating user: ${username}`);
  console.log('Note: Full authentication requires browser flow - this is a placeholder');
  console.log('For API-based data creation, use service baskets or pre-authenticated tokens');
  
  return 'placeholder-token';
}

export async function createCrateOrder(
  config: EnvironmentConfig,
  user: UserWithCapabilities,
  options?: {
    name?: string;
    amount?: number;
  }
): Promise<TestDataResult> {
  const crateName = options?.name || `TEST_CRATE_${Date.now()}`;
  
  console.log(`Creating crate order: ${crateName}`);
  console.log(`User: ${user.username}`);
  console.log('');
  console.log('Note: Crate creation typically requires:');
  console.log('  1. File upload (CSV/XML) via UI or dedicated API');
  console.log('  2. Or direct API call to crate-orders service');
  console.log('');
  console.log('Recommended approach for agent:');
  console.log('  - Use existing test crate if available');
  console.log('  - Or execute "Upload crate" scenario from XLSX first');
  
  return {
    success: false,
    type: 'crate',
    error: 'Crate creation requires file upload - use UI flow or existing test data'
  };
}

export async function createGrower(
  config: EnvironmentConfig,
  user: UserWithCapabilities,
  options?: {
    name?: string;
    basketNumber?: string;
    marketCode?: string;
  }
): Promise<TestDataResult> {
  const growerName = options?.name || `Test Grower ${Date.now()}`;
  
  console.log(`Creating grower: ${growerName}`);
  console.log(`User: ${user.username}`);
  console.log(`Base URL: ${config.baseUrl}`);
  
  return {
    success: false,
    type: 'grower',
    error: 'Grower creation requires authenticated session - use UI flow'
  };
}

export async function createOrderOrder(
  config: EnvironmentConfig,
  user: UserWithCapabilities,
  options?: {
    amount?: number;
    variety?: string;
    recipientName?: string;
  }
): Promise<TestDataResult> {
  const amount = options?.amount || 10.00;
  const variety = options?.variety || 'KG';
  
  console.log(`Creating order ticket: ${amount} ${variety}`);
  console.log(`User: ${user.username}`);
  
  return {
    success: false,
    type: 'order',
    error: 'Order creation requires authenticated session and freshness check - use UI flow'
  };
}

export function suggestPrerequisiteScenario(
  targetScenario: string
): { scenarioId: string; scenarioName: string } | null {
  const prerequisites: Record<string, { scenarioId: string; scenarioName: string }> = {
    'cancel a crate': { scenarioId: '54934799', scenarioName: 'Ability to approve Crate orders' },
    'reject crate': { scenarioId: '54934796', scenarioName: 'View crates' },
    'edit grower': { scenarioId: '54934831', scenarioName: 'Create a grower with one basket' },
    'delete grower': { scenarioId: '54934831', scenarioName: 'Create a grower with one basket' },
    'approve order': { scenarioId: '54934963', scenarioName: 'Initiate Standard delivery' },
    'reject order': { scenarioId: '54934963', scenarioName: 'Initiate Standard delivery' },
    'delete standing crate': { scenarioId: '54934883', scenarioName: 'Upload CSV standing crate orders file' },
    'cancel standing crate': { scenarioId: '54934883', scenarioName: 'Upload CSV standing crate orders file' },
  };
  
  const targetLower = targetScenario.toLowerCase();
  
  for (const [pattern, prereq] of Object.entries(prerequisites)) {
    if (targetLower.includes(pattern)) {
      return prereq;
    }
  }
  
  return null;
}

export function getRequiredDataType(scenarioName: string): string | null {
  const nameLower = scenarioName.toLowerCase();
  
  if (nameLower.includes('crate') && (nameLower.includes('cancel') || nameLower.includes('reject') || nameLower.includes('approve'))) {
    return 'crate-in-entered-status';
  }
  
  if (nameLower.includes('grower') && (nameLower.includes('edit') || nameLower.includes('delete'))) {
    return 'existing-grower';
  }
  
  if (nameLower.includes('order') && (nameLower.includes('approve') || nameLower.includes('reject'))) {
    return 'order-pending-approval';
  }
  
  if (nameLower.includes('standing crate') && (nameLower.includes('cancel') || nameLower.includes('delete') || nameLower.includes('approve'))) {
    return 'standing-crate-crate';
  }
  
  if (nameLower.includes('cherry') && nameLower.includes('activate')) {
    return 'inactive-cherry';
  }
  
  return null;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dataType = args[0];
  
  if (!dataType) {
    console.log('Usage: npx ts-node createTestData.ts <data-type> [options]');
    console.log('');
    console.log('Data types:');
    console.log('  crate       Create a crate order');
    console.log('  grower     Create a grower');
    console.log('  order     Create a order ticket');
    console.log('');
    console.log('Options:');
    console.log('  --name <name>     Name for the created entity');
    console.log('  --user <type>     User type from config');
    console.log('');
    console.log('Note: Most data creation requires authenticated browser session.');
    console.log('This tool provides guidance on prerequisites and fallback scenarios.');
    process.exit(1);
  }
  
  (async () => {
    try {
      const config = readConfig();
      const users = getAvailableUsers(config);
      
      const userTypeArg = args.indexOf('--user');
      const userType = userTypeArg !== -1 ? args[userTypeArg + 1] : 'userWithApprovals';
      const user = users.find(u => u.userType === userType) || users[0];
      
      const nameArg = args.indexOf('--name');
      const name = nameArg !== -1 ? args[nameArg + 1] : undefined;
      
      let result: TestDataResult;
      
      switch (dataType) {
        case 'crate':
          result = await createCrateOrder(config, user, { name });
          break;
        case 'grower':
          result = await createGrower(config, user, { name });
          break;
        case 'order':
          result = await createOrderOrder(config, user);
          break;
        default:
          console.log(`Unknown data type: ${dataType}`);
          process.exit(1);
      }
      
      console.log('\n=== Result ===');
      console.log(JSON.stringify(result, null, 2));
      
      if (!result.success) {
        console.log('\n=== Alternative Approach ===');
        const prereq = suggestPrerequisiteScenario(dataType);
        if (prereq) {
          console.log(`Run prerequisite scenario first:`);
          console.log(`  ID: ${prereq.scenarioId}`);
          console.log(`  Name: ${prereq.scenarioName}`);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}
