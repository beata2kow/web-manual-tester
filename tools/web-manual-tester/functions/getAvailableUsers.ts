#!/usr/bin/env npx ts-node
/**
 * Get available test users from configuration with capability detection
 * Usage: npx ts-node libs/memory/agents/functions/getAvailableUsers.ts [config-path] [--capability <cap>]
 */

import { readConfig, UserConfig, EnvironmentConfig } from './readConfig';

export type UserCapability = 
  | 'standard'
  | 'approvals'
  | 'admin'
  | 'multi-context'
  | 'no-approval-policy'
  | '2fa-login'
  | 'employee';

export interface UserWithCapabilities {
  userType: string;
  username: string;
  password: string;
  email?: string;
  phoneNumber?: string;
  fullName?: string;
  capabilities: UserCapability[];
  description?: string;
}

function detectCapabilities(userType: string, user: UserConfig): UserCapability[] {
  const capabilities: UserCapability[] = ['standard'];
  
  if (user.isAdmin || user.masterContext?.isAdmin) {
    capabilities.push('admin');
  }
  
  if (user.customContext) {
    capabilities.push('multi-context');
  }
  
  if (userType.toLowerCase().includes('approval') || 
      user.description?.toLowerCase().includes('approval')) {
    capabilities.push('approvals');
  }
  
  if (userType.toLowerCase().includes('withoutapprovalpolicy') ||
      user.description?.toLowerCase().includes('no approval policy')) {
    capabilities.push('no-approval-policy');
  }
  
  if (userType.toLowerCase().includes('2fa') ||
      user.description?.toLowerCase().includes('2fa')) {
    capabilities.push('2fa-login');
  }
  
  if (userType.toLowerCase().includes('employee')) {
    capabilities.push('employee');
  }
  
  return [...new Set(capabilities)];
}

export function getAvailableUsers(config: EnvironmentConfig): UserWithCapabilities[] {
  const users: UserWithCapabilities[] = [];
  
  for (const [userType, userConfig] of Object.entries(config.users)) {
    users.push({
      userType,
      username: userConfig.username,
      password: userConfig.password,
      email: userConfig.email,
      phoneNumber: userConfig.phoneNumber,
      fullName: userConfig.fullName,
      capabilities: detectCapabilities(userType, userConfig),
      description: userConfig.description
    });
  }
  
  return users;
}

export function getUsersByCapability(
  config: EnvironmentConfig, 
  capability: UserCapability
): UserWithCapabilities[] {
  const allUsers = getAvailableUsers(config);
  return allUsers.filter(u => u.capabilities.includes(capability));
}

export function suggestUserForScenario(
  config: EnvironmentConfig,
  scenarioName: string,
  preferredUsername?: string
): UserWithCapabilities | null {
  const allUsers = getAvailableUsers(config);

  if (preferredUsername) {
    const preferred = allUsers.find(user => user.username === preferredUsername);
    if (preferred) {
      return preferred;
    }
  }
  
  const nameLower = scenarioName.toLowerCase();
  
  if (nameLower.includes('audit') ||
      nameLower.includes('admin') || 
      nameLower.includes('user management') ||
      nameLower.includes('company administration') ||
      nameLower.includes('company permissions')) {
    const adminUsers = allUsers.filter(u => u.capabilities.includes('admin'));
    if (adminUsers.length > 0) return adminUsers[0];
  }
  
  if (nameLower.includes('approve') || 
      nameLower.includes('reject') ||
      nameLower.includes('sign')) {
    const approvalUsers = allUsers.filter(u => u.capabilities.includes('approvals'));
    if (approvalUsers.length > 0) return approvalUsers[0];
  }
  
  if (nameLower.includes('context') || nameLower.includes('switch')) {
    const multiContextUsers = allUsers.filter(u => u.capabilities.includes('multi-context'));
    if (multiContextUsers.length > 0) return multiContextUsers[0];
  }
  
  if (nameLower.includes('2fa') || nameLower.includes('two-factor')) {
    const twoFaUsers = allUsers.filter(u => u.capabilities.includes('2fa-login'));
    if (twoFaUsers.length > 0) return twoFaUsers[0];
  }
  
  const standardUsers = allUsers.filter(u => 
    !u.capabilities.includes('admin') && 
    !u.capabilities.includes('2fa-login')
  );
  
  return standardUsers.length > 0 ? standardUsers[0] : allUsers[0] || null;
}

export function getNextFallbackUser(
  config: EnvironmentConfig,
  excludeUsernames: string[]
): UserWithCapabilities | null {
  const allUsers = getAvailableUsers(config);
  const available = allUsers.filter(u => !excludeUsernames.includes(u.username));
  return available.length > 0 ? available[0] : null;
}

export class UserSessionMemory {
  private wins = new Map<string, string>();

  recordSuccess(area: string, username: string): void {
    this.wins.set(area, username);
  }

  getBestGuess(area: string): string | undefined {
    return this.wins.get(area);
  }
}

export const userSessionMemory = new UserSessionMemory();

if (require.main === module) {
  const args = process.argv.slice(2);
  const configPath = args.find(a => !a.startsWith('--'));
  
  const capIndex = args.indexOf('--capability');
  const filterCapability = capIndex !== -1 ? args[capIndex + 1] as UserCapability : undefined;
  
  try {
    const config = readConfig(configPath);
    let users: UserWithCapabilities[];
    
    if (filterCapability) {
      users = getUsersByCapability(config, filterCapability);
      console.log(`=== Users with capability: ${filterCapability} ===\n`);
    } else {
      users = getAvailableUsers(config);
      console.log('=== All Available Users ===\n');
    }
    
    for (const user of users) {
      console.log(`${user.userType}:`);
      console.log(`  Username: ${user.username}`);
      console.log(`  Email: ${user.email || 'N/A'}`);
      console.log(`  Capabilities: ${user.capabilities.join(', ')}`);
      if (user.description) {
        console.log(`  Description: ${user.description}`);
      }
      console.log('');
    }
    
    console.log('=== Users (JSON) ===');
    console.log(JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error getting users:', error);
    process.exit(1);
  }
}
