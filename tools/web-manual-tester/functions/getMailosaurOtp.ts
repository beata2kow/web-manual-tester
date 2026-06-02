#!/usr/bin/env npx ts-node
/**
 * Retrieve OTP code from Mailosaur API
 * Usage: npx ts-node libs/memory/agents/functions/getMailosaurOtp.ts <email> [--after <ISO_TIMESTAMP>] [--retry <count>]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface MailosaurMessage {
  id: string;
  received: string;
  from: { email: string }[];
  to: { email: string }[];
  subject: string;
  summary?: string;
  text?: { body: string };
  html?: { body: string };
}

interface MailosaurResponse {
  items: MailosaurMessage[];
}

const SECRETS_PATH_CANDIDATES = [
  'libs/stand-a-e2e/src/secrets/.env',
  'libs/stand-b-e2e/src/secrets/.env'
];
const DEFAULT_SERVER = process.env.MAILOSAUR_DEFAULT_SERVER || '<mailosaur-server-id>';
const OTP_PATTERN = /\b(\d{6})\b/;

function resolveSecretsPath(): string {
  const explicitPath = process.env.AGENT_SECRETS_PATH;
  if (explicitPath) {
    const fullPath = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.join(process.cwd(), explicitPath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    throw new Error(`AGENT_SECRETS_PATH does not exist: ${fullPath}`);
  }

  for (const relativePath of SECRETS_PATH_CANDIDATES) {
    const fullPath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  throw new Error(`Secrets file not found. Provide --secrets or set AGENT_SECRETS_PATH. Tried: ${SECRETS_PATH_CANDIDATES.join(', ')}`);
}

function loadSecrets(): { apiKey: string; server: string } {
  const envPath = resolveSecretsPath();
  
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  
  let apiKey = process.env.MAILOSAUR_API_KEY || process.env.STAND_A_MAILOSAUR_API_KEY || process.env.STAND_B_MAILOSAUR_API_KEY || '';
  let server = process.env.MAILOSAUR_SERVER || process.env.STAND_A_MAILOSAUR_SERVER || process.env.STAND_B_MAILOSAUR_SERVER || DEFAULT_SERVER;
  
  for (const line of lines) {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    
    if (key === 'MAILOSAUR_API_KEY' || key === 'STAND_A_MAILOSAUR_API_KEY' || key === 'STAND_B_MAILOSAUR_API_KEY') {
      apiKey = value.replace(/["']/g, '');
    }
    if (key === 'MAILOSAUR_SERVER' || key === 'STAND_A_MAILOSAUR_SERVER' || key === 'STAND_B_MAILOSAUR_SERVER') {
      server = value.replace(/["']/g, '');
    }
  }
  
  if (!apiKey) {
    throw new Error('MAILOSAUR API key not found in secrets (checked generic and per-stand keys)');
  }
  
  return { apiKey, server };
}

function makeRequest(url: string, apiKey: string): Promise<MailosaurResponse> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    
    const options = {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    };
    
    https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Mailosaur API error: ${res.statusCode} - ${data}`));
          return;
        }
        
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse Mailosaur response: ${e}`));
        }
      });
    }).on('error', reject);
  });
}

function extractOtp(message: MailosaurMessage): string | null {
  const searchText = [
    message.summary,
    message.text?.body,
    message.subject
  ].filter(Boolean).join(' ');
  
  const match = searchText.match(OTP_PATTERN);
  return match ? match[1] : null;
}

export async function getMailosaurOtp(
  email: string,
  options?: {
    receivedAfter?: string;
    retryCount?: number;
    retryDelayMs?: number;
  }
): Promise<{ otp: string; messageId: string; receivedAt: string } | null> {
  const { apiKey, server } = loadSecrets();
  const receivedAfter = options?.receivedAfter || new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const retryCount = options?.retryCount ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 5000;
  
  const encodedEmail = encodeURIComponent(email);
  const encodedAfter = encodeURIComponent(receivedAfter);
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      console.log(`Retry ${attempt}/${retryCount} - waiting ${retryDelayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    
    const url = `https://mailosaur.com/api/messages?server=${server}&sentTo=${encodedEmail}&receivedAfter=${encodedAfter}`;
    
    try {
      const response = await makeRequest(url, apiKey);
      
      if (response.items && response.items.length > 0) {
        const sortedMessages = response.items.sort(
          (a, b) => new Date(b.received).getTime() - new Date(a.received).getTime()
        );
        
        const latestMessage = sortedMessages[0];
        const otp = extractOtp(latestMessage);
        
        if (otp) {
          return {
            otp,
            messageId: latestMessage.id,
            receivedAt: latestMessage.received
          };
        }
        
        console.log(`Message found but no OTP pattern detected in message ${latestMessage.id}`);
      } else {
        console.log(`No messages found for ${email} after ${receivedAfter}`);
      }
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error);
      if (attempt === retryCount) {
        throw error;
      }
    }
  }
  
  return null;
}

export async function waitForOtp(
  email: string,
  timeoutMs: number = 30000
): Promise<{ otp: string; messageId: string; receivedAt: string }> {
  const startTime = Date.now();
  const receivedAfter = new Date(startTime - 1000).toISOString();
  
  while (Date.now() - startTime < timeoutMs) {
    const result = await getMailosaurOtp(email, { 
      receivedAfter, 
      retryCount: 0 
    });
    
    if (result) {
      return result;
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  throw new Error(`Timeout waiting for OTP email to ${email}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const email = args.find(a => !a.startsWith('--'));
  
  if (!email) {
    console.log('Usage: npx ts-node getMailosaurOtp.ts <email> [--after <ISO_TIMESTAMP>] [--retry <count>]');
    console.log('');
    console.log('Example:');
    console.log('  npx ts-node getMailosaurOtp.ts user@<mailosaur-server-id>.mailosaur.net');
    console.log('  npx ts-node getMailosaurOtp.ts user@<mailosaur-server-id>.mailosaur.net --after 2026-04-18T10:00:00Z');
    process.exit(1);
  }
  
  const afterIndex = args.indexOf('--after');
  const receivedAfter = afterIndex !== -1 ? args[afterIndex + 1] : undefined;
  
  const retryIndex = args.indexOf('--retry');
  const retryCount = retryIndex !== -1 ? parseInt(args[retryIndex + 1], 10) : 3;
  
  (async () => {
    try {
      console.log(`Fetching OTP for: ${email}`);
      if (receivedAfter) {
        console.log(`Messages after: ${receivedAfter}`);
      }
      console.log('');
      
      const result = await getMailosaurOtp(email, { receivedAfter, retryCount });
      
      if (result) {
        console.log('=== OTP Retrieved ===');
        console.log(`OTP: ${result.otp}`);
        console.log(`Message ID: ${result.messageId}`);
        console.log(`Received at: ${result.receivedAt}`);
        
        console.log('\n=== Result (JSON) ===');
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('No OTP found in recent messages');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error retrieving OTP:', error);
      process.exit(1);
    }
  })();
}
