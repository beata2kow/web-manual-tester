#!/usr/bin/env npx ts-node
/**
 * Read environment configuration for test execution
 * Usage: npx ts-node libs/memory/agents/functions/readConfig.ts [config-path]
 */

import * as fs from 'fs';
import * as path from 'path';

export interface UserConfig {
  username: string;
  password: string;
  phoneNumber?: string;
  email?: string;
  fullName?: string;
  masterContext?: {
    name: string;
    contextDescription?: string;
    isAdmin: boolean;
  };
  customContext?: {
    name: string;
    isAdmin: boolean;
  };
  cherryHolder?: string;
  isAdmin?: boolean;
  description?: string;
}

export interface OtpConfig {
  messageServiceProvider: string;
  otpFromNumber: string;
  otpFromEmail: string;
}

export interface EnvironmentConfig {
  baseUrl: string;
  identityBaseUrl?: string;
  produceKey: string;
  produceHeader?: string;
  produceToken?: string;
  otpConfirmationConfig: OtpConfig;
  users: Record<string, UserConfig>;
  platform?: {
    baseUrl?: string;
    identityBaseUrl?: string;
  };
}

const DEFAULT_APPS_DIR = 'apps';

function resolveDefaultConfigDir(): string {
  const appsDir = path.join(process.cwd(), DEFAULT_APPS_DIR);
  if (!fs.existsSync(appsDir)) {
    throw new Error(`Apps directory not found: ${DEFAULT_APPS_DIR}`);
  }

  const configDirs = fs.readdirSync(appsDir)
    .map(entry => path.join(appsDir, entry, 'config'))
    .filter(configDir => fs.existsSync(configDir) && fs.statSync(configDir).isDirectory())
    .sort((left, right) => left.localeCompare(right));

  if (configDirs.length === 0) {
    throw new Error('No config directories found under apps/*/config');
  }

  return configDirs[0];
}

function resolveFirstJsonConfig(configDir: string): string {
  const fullDirPath = path.isAbsolute(configDir)
    ? configDir
    : path.join(process.cwd(), configDir);

  if (!fs.existsSync(fullDirPath)) {
    throw new Error(`Config directory not found: ${configDir}`);
  }

  const firstJsonFile = fs.readdirSync(fullDirPath)
    .filter(fileName => fileName.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .at(0);

  if (!firstJsonFile) {
    throw new Error(`No JSON config files found in directory: ${configDir}`);
  }

  return path.join(fullDirPath, firstJsonFile);
}

export function readConfig(configPath?: string): EnvironmentConfig {
  const resolvedPath = configPath
    ? (path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath))
    : resolveFirstJsonConfig(resolveDefaultConfigDir());

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${configPath ?? resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = JSON.parse(content) as EnvironmentConfig;

  // Normalize schema differences between the two config shapes.
  const normalized: EnvironmentConfig = {
    ...parsed,
    identityBaseUrl: parsed.identityBaseUrl ?? parsed.platform?.identityBaseUrl ?? parsed.baseUrl,
    produceHeader: parsed.produceHeader ?? parsed.produceToken,
  };

  return normalized;
}

export function getBaseUrl(config: EnvironmentConfig): string {
  return config.baseUrl;
}

export function getIdentityUrl(config: EnvironmentConfig): string {
  return config.identityBaseUrl ?? config.platform?.identityBaseUrl ?? config.baseUrl;
}

export function getProduceHeader(config: EnvironmentConfig): string {
  return config.produceHeader ?? config.produceToken ?? '';
}

export function getOtpConfig(config: EnvironmentConfig): OtpConfig {
  return config.otpConfirmationConfig;
}

if (require.main === module) {
  const configPath = process.argv[2];
  
  try {
    const config = readConfig(configPath);
    
    console.log('=== Environment Configuration ===\n');
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Identity URL: ${getIdentityUrl(config)}`);
    console.log(`PRODUCE Header Value Present: ${getProduceHeader(config) ? 'yes' : 'no'}`);
    console.log(`OTP Provider: ${config.otpConfirmationConfig.messageServiceProvider}`);
    console.log(`\nAvailable users: ${Object.keys(config.users).length}`);
    
    for (const [userType, user] of Object.entries(config.users)) {
      console.log(`  - ${userType}: ${user.username}`);
    }
    
    console.log('\n=== Full Config (JSON) ===');
    console.log(JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error reading config:', error);
    process.exit(1);
  }
}
