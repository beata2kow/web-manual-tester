/**
 * Classifies BDD step lines so the runner skips setup/permission lines
 * instead of marking them "Unhandled".
 */

export type PreconditionKind = 'none' | 'skip-assumed' | 'skip-data' | 'otp';

export interface PreconditionResult {
  kind: PreconditionKind;
  reason: string;
}

const PERMISSION_PATTERNS = [
  /user\s+has\s+permission(s)?\s+to\b/i,
  /user\s+has\s+permission\s+to\b/i,
  /permission\s+to\s+access\s+more\s+than\s+one\s+contexts?/i,
  /user\s+has\s+approval\s+permissions/i,
  /approvals?\s+policy\s+is\s+enabled/i,
  /approval\s+with\s+two\s+approvers\s+is\s+enabled/i
];

const ENV_SETUP_PATTERNS = [
  /user\s+lands?\s+on\b/i,
  /i\s+am\s+in\s+the\b.+\b(?:first\s+page|app)\b/i,
  /user\s+is\s+on\b/i,
  /logged\s+(?:into|in)\b/i,
  /there\s+are\b.+\bavailable/i,
  /user\s+can\s+see\s+list\s+of\b/i,
  /the\s+profile\s+tab\s+is\s+clicked/i,
  /fill\s+the\s+username/i,
  /logs?\s+in\s+using\s+correct\s+credentials/i,
  /login\s+with\s+their\s+new\s+username/i,
  /user\s+has\s+(?:all\s+)?(?:quick\s+actions|tiles)\s+(?:not\s+)?visible/i,
  /aggregated\s+stocks\s+are\s+enabled/i,
  /the\s+template\s+has\s+secured/i,
  /journey\s+configuration\s+defines/i,
  /user\s+has\s+a\s+valid\s+phone\s+number\s+set/i,
  /seedling\s+is\s+not\s+overdue/i,
  /overdue\s+configuration\s+allows/i
];

const DATA_ASSUMPTION_PATTERNS = [
  /at\s+least\s+one\b/i,
  /at\s+least\s+few\b/i,
  /at\s+least\s+two\b/i,
  /user\s+has\s+(?:some|created|added|configured)\b/i,
  /user\s+has\s+order\s+in\b/i,
  /user\s+basket\s+is\s+active/i,
  /user\s+has\s+changed\s+their\s+username/i,
  /user\s+has\s+the\s+accept\s+t&cs/i,
  /user\s+configured\b/i,
  /enough\s+baskets\s+to\s+show\s+as\s+grouped/i,
  /didn'?t\s+configure\s+the\s+single\s+group\s+view/i,
  /grower\s+list\s+contains\s+multiple\s+records/i,
  /engagement\s+banner\s+carousel\s+is\s+setup/i,
  /carousel\s+is\s+setup/i,
  /user\s+has\s+at\s+least\s+(?:two\s+)?favorite/i,
  /crate\s+created\s+in\s+advance/i,
  /user\s+can\s+see\s+a\s+crate\s+in/i
];

const OTP_PATTERNS = [
  /picking\s+signing/i,
  /\botp\b/i,
  /authori[sz]ation\s+code/i,
  /email\s+me\s+a\s+code/i,
  /text\s+me\s+a\s+code/i
];

export function classifyPrecondition(text: string): PreconditionResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'none', reason: '' };
  }

  if (OTP_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return { kind: 'otp', reason: 'Freshness check / OTP step' };
  }

  if (PERMISSION_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return {
      kind: 'skip-assumed',
      reason: 'Precondition assumed (test user entitlements): permissions step'
    };
  }

  if (ENV_SETUP_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return {
      kind: 'skip-assumed',
      reason: 'Precondition assumed (session/navigation state): environment setup step'
    };
  }

  if (DATA_ASSUMPTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return {
      kind: 'skip-data',
      reason: 'Precondition assumed (test data): will verify during actionable steps or report missing data'
    };
  }

  return { kind: 'none', reason: '' };
}

export function isSkippablePreconditionText(text: string): boolean {
  const kind = classifyPrecondition(text).kind;
  return kind === 'skip-assumed' || kind === 'skip-data';
}

export function isOtpPreconditionText(text: string): boolean {
  return classifyPrecondition(text).kind === 'otp';
}
