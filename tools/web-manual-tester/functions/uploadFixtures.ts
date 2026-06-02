import * as fs from 'fs';
import * as path from 'path';

import { FeatureArea } from './parseXlsxScenarios';

/** E2E upload files in the repository (not generated at runtime). */
const AREA_UPLOAD_DIRS: Partial<Record<FeatureArea, string[]>> = {
  'standing-crates': ['apps/produce-stand-e2e/src/specs/standing-crate/files'],
  crates: ['apps/produce-stand-e2e/src/specs/crates'],
  growers: ['apps/produce-stand-e2e/src/data'],
  orders: ['apps/produce-stand-e2e/src/specs/crates']
};

const STEP_FILE_HINTS: Array<{ pattern: RegExp; fileNames: string[] }> = [
  { pattern: /standarddd|direct\s+outflow/i, fileNames: ['csv-standarddd.csv'] },
  { pattern: /standard1|crate.*1/i, fileNames: ['standard1.csv'] },
  { pattern: /standard|crate/i, fileNames: ['standard.csv', 'standard1.csv'] },
  { pattern: /grower/i, fileNames: ['growersTestUpload.csv'] },
  { pattern: /\.xlsx|xlsx/i, fileNames: [] },
  { pattern: /\.csv|csv/i, fileNames: ['standard.csv', 'csv-standarddd.csv', 'growersTestUpload.csv'] }
];

function listFilesRecursive(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, extensions));
      continue;
    }
    if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

function resolveByFileName(repoRoot: string, dirs: string[], fileNames: string[]): string | null {
  for (const dir of dirs) {
    const absoluteDir = path.join(repoRoot, dir);
    for (const fileName of fileNames) {
      const candidate = path.join(absoluteDir, fileName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Picks an upload file from repository E2E fixtures for the scenario area/step text.
 */
export function resolveUploadFixturePath(
  repoRoot: string,
  area: FeatureArea,
  stepText: string
): string | null {
  const dirs = AREA_UPLOAD_DIRS[area] || [
    'apps/produce-stand-e2e/src/specs/standing-crate/files',
    'apps/produce-stand-e2e/src/specs/crates',
    'apps/produce-stand-e2e/src/data'
  ];

  for (const hint of STEP_FILE_HINTS) {
    if (!hint.pattern.test(stepText)) {
      continue;
    }
    if (hint.fileNames.length > 0) {
      const resolved = resolveByFileName(repoRoot, dirs, hint.fileNames);
      if (resolved) {
        return resolved;
      }
    }
  }

  const extensions = stepText.toLowerCase().includes('xlsx') ? ['.xlsx'] : ['.csv', '.xlsx'];
  const discovered: string[] = [];
  for (const dir of dirs) {
    discovered.push(...listFilesRecursive(path.join(repoRoot, dir), extensions));
  }

  if (discovered.length === 1) {
    return discovered[0];
  }

  if (discovered.length > 1) {
    const preferred = discovered.find(file => /standarddd|standard\.csv|growersTestUpload/i.test(file));
    return preferred || discovered[0];
  }

  return null;
}
