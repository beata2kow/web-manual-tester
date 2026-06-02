import * as fs from 'fs';
import * as path from 'path';

const REQUIRED_REPO_MODULES = ['playwright', 'xlsx'] as const;

export class RepoRootNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoRootNotFoundError';
  }
}

function hasRepoDependencies(repoRoot: string): boolean {
  return REQUIRED_REPO_MODULES.every(moduleName =>
    fs.existsSync(path.join(repoRoot, 'node_modules', moduleName, 'package.json'))
  );
}

function parseRepoRootFromArgv(argv: string[]): string | undefined {
  const inline = argv.find(arg => arg.startsWith('--repo-root='));
  if (inline) {
    return inline.split('=').slice(1).join('=');
  }

  const index = argv.indexOf('--repo-root');
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }

  return undefined;
}

function parseXlsxPathFromArgv(argv: string[]): string | undefined {
  const inline = argv.find(arg => arg.startsWith('--xlsx='));
  if (inline) {
    return inline.split('=').slice(1).join('=');
  }

  const index = argv.indexOf('--xlsx');
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }

  return undefined;
}

function findRepoRootByWalkingUp(startDir: string, maxDepth = 12): string | null {
  let dir = path.resolve(startDir);

  for (let depth = 0; depth < maxDepth; depth++) {
    if (hasRepoDependencies(dir)) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return null;
}

const WORKBOOK_SEARCH_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.nx',
  'tmp',
  '.cache',
  '.agent-reports',
  '.idea',
  '.vscode',
  '.cursor'
]);

function findWorkbookFilesInRepo(repoRoot: string, maxDepth = 10): string[] {
  const results: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (WORKBOOK_SEARCH_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath, depth + 1);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.xlsx') && !entry.name.startsWith('~$')) {
        results.push(fullPath);
      }
    }
  };

  walk(repoRoot, 0);
  return results.sort((left, right) => left.localeCompare(right));
}

function inferRepoRootFromWorkbookPath(xlsxPath: string): string | null {
  const absolutePath = path.resolve(xlsxPath);
  const markers = [
    `${path.sep}.agent${path.sep}`,
    `${path.sep}.memory${path.sep}`,
    `${path.sep}libs${path.sep}memory${path.sep}`,
    `${path.sep}apps${path.sep}`
  ];

  let dir = path.dirname(absolutePath);
  while (dir && dir !== path.dirname(dir)) {
    if (markers.some(marker => absolutePath.includes(marker)) && hasRepoDependencies(dir)) {
      return dir;
    }

    if (fs.existsSync(path.join(dir, 'apps')) && hasRepoDependencies(dir)) {
      return dir;
    }

    dir = path.dirname(dir);
  }

  return findRepoRootByWalkingUp(path.dirname(absolutePath));
}

/**
 * Resolves the target application repository root.
 * The global runner lives outside the repo; dependencies must come from repo/node_modules.
 */
export function resolveRepoRoot(argv: string[] = process.argv.slice(2)): string {
  const candidates: string[] = [];

  const fromArgv = parseRepoRootFromArgv(argv);
  if (fromArgv) {
    candidates.push(fromArgv);
  }

  if (process.env.WEB_MANUAL_TESTER_REPO_ROOT) {
    candidates.push(process.env.WEB_MANUAL_TESTER_REPO_ROOT);
  }

  const xlsxArg = parseXlsxPathFromArgv(argv);
  if (xlsxArg) {
    const inferred = inferRepoRootFromWorkbookPath(xlsxArg);
    if (inferred) {
      candidates.push(inferred);
    }
    candidates.push(path.dirname(path.resolve(xlsxArg)));
  }

  candidates.push(process.cwd());

  const normalized = [...new Set(candidates.map(candidate => path.resolve(candidate)))];

  for (const candidate of normalized) {
    if (hasRepoDependencies(candidate)) {
      return candidate;
    }

    const walked = findRepoRootByWalkingUp(candidate);
    if (walked) {
      return walked;
    }
  }

  throw new RepoRootNotFoundError(
    [
      'Cannot find repository root (expected node_modules/playwright and node_modules/xlsx).',
      'The runner is installed globally; Node must load dependencies from your app repo, not from ~/.agents/tools/web-manual-tester.',
      '',
      'Fix:',
      '  1. Run from the repo: cd /path/to/web-market-apps',
      '  2. Pass an explicit root: --repo-root /path/to/web-market-apps',
      '  3. Or set env: WEB_MANUAL_TESTER_REPO_ROOT=/path/to/web-market-apps',
      '  4. In Copilot: use ~/.agents/bin/web-manual-tester /path/to/web-market-apps -- ...',
      '',
      `Checked paths: ${normalized.join(', ')}`
    ].join('\n')
  );
}

export function getRepoRootFromArgs(argv: string[] = process.argv.slice(2)): string {
  return resolveRepoRoot(argv);
}

export function configureRepoModuleResolution(repoRoot?: string): string {
  const resolvedRepoRoot = repoRoot ? path.resolve(repoRoot) : resolveRepoRoot();

  if (!hasRepoDependencies(resolvedRepoRoot)) {
    throw new RepoRootNotFoundError(
      `Repository at ${resolvedRepoRoot} is missing Playwright/XLSX dependencies. Run npm install in that repo.`
    );
  }

  const repoNodeModules = path.join(resolvedRepoRoot, 'node_modules');
  const existingNodePath = process.env.NODE_PATH || '';
  process.env.NODE_PATH = existingNodePath
    ? `${repoNodeModules}${path.delimiter}${existingNodePath}`
    : repoNodeModules;
  process.env.WEB_MANUAL_TESTER_REPO_ROOT = resolvedRepoRoot;

  return resolvedRepoRoot;
}

export function requireRepoModule<T = unknown>(
  moduleName: string,
  repoRoot = getRepoRootFromArgs()
): T {
  const modulePath = path.join(repoRoot, 'node_modules', moduleName);
  if (!fs.existsSync(modulePath)) {
    throw new RepoRootNotFoundError(
      `Module "${moduleName}" not found at ${modulePath}. Run npm install in ${repoRoot} and pass --repo-root explicitly if needed.`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath) as T;
}

/**
 * Finds the scenario workbook in the repo.
 * Does not assume a fixed folder (.agent/documents, .agent/lib, .memory, etc.).
 * If exactly one .xlsx exists (excluding Excel lock files), that file is used.
 */
export function resolveDefaultWorkbookPath(repoRoot: string): string {
  const workbooks = findWorkbookFilesInRepo(repoRoot);

  if (workbooks.length === 1) {
    console.log(`    Using workbook: ${workbooks[0]}`);
    return workbooks[0];
  }

  if (workbooks.length === 0) {
    throw new Error(
      `No .xlsx workbook found under ${repoRoot}. Add your scenario file anywhere in the repo (e.g. .agent/lib/scenarios.xlsx) or pass --xlsx /path/to/file.xlsx`
    );
  }

  const underAgent = workbooks.filter(file => file.includes(`${path.sep}.agent${path.sep}`));
  if (underAgent.length === 1) {
    console.log(`    Using workbook: ${underAgent[0]}`);
    return underAgent[0];
  }

  throw new Error(
    [
      `Multiple .xlsx files found (${workbooks.length}). Pass --xlsx explicitly:`,
      ...workbooks.map(file => `  - ${file}`)
    ].join('\n')
  );
}
