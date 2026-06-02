import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  scenarioId: string;
  scenarioName: string;
  status: 'passed' | 'passed-with-deviation' | 'failed' | 'blocked';
  note?: string;
  screenshot?: string;
  user?: string;
  context?: string;
}

export interface TestReportSummary {
  total: number;
  passed: number;
  passedWithDeviation: number;
  failed: number;
  blocked: number;
}

export interface TestReportJson {
  area: string;
  date: string;
  summary: TestReportSummary;
  results: TestResult[];
}

function buildReportSummary(results: TestResult[]): TestReportSummary {
  return {
    total: results.length,
    passed: results.filter(result => result.status === 'passed').length,
    passedWithDeviation: results.filter(result => result.status === 'passed-with-deviation').length,
    failed: results.filter(result => result.status === 'failed').length,
    blocked: results.filter(result => result.status === 'blocked').length
  };
}

function addExecutionIdentityLine(result: TestResult): string {
  if (!result.user) {
    return '';
  }
  return `  > User: ${result.user}${result.context ? ` | Context: ${result.context}` : ''}\n`;
}

export function generateReport(area: string, results: TestResult[], reportsDir: string): void {
  const date = new Date().toISOString().split('T')[0];
  const markdownFilename = path.join(reportsDir, `${area}-${date}.md`);
  const jsonFilename = path.join(reportsDir, `${area}-${date}.json`);

  const passed = results.filter(result => result.status === 'passed');
  const passedWithDeviation = results.filter(result => result.status === 'passed-with-deviation');
  const failed = results.filter(result => result.status === 'failed');
  const blocked = results.filter(result => result.status === 'blocked');

  let content = `# Manual Test Report - ${area} - ${date}\n\n`;
  content += '## Summary\n';
  content += `- Total: ${results.length} | Passed: ${passed.length} | Passed with deviation: ${passedWithDeviation.length} | Failed: ${failed.length} | Blocked: ${blocked.length}\n\n`;
  content += '## Results\n\n';

  if (passed.length > 0) {
    content += '### Passed\n';
    for (const result of passed) {
      content += `- ${result.scenarioId} - ${result.scenarioName}\n`;
      content += addExecutionIdentityLine(result);
    }
    content += '\n';
  }

  if (passedWithDeviation.length > 0) {
    content += '### Passed with deviation\n';
    for (const result of passedWithDeviation) {
      content += `- ${result.scenarioId} - ${result.scenarioName}\n`;
      content += addExecutionIdentityLine(result);
      if (result.note) {
        content += `  > ${result.note}\n`;
      }
      if (result.screenshot) {
        content += `  > Screenshot: ${result.screenshot}\n`;
      }
    }
    content += '\n';
  }

  if (failed.length > 0) {
    content += '### Failed\n';
    for (const result of failed) {
      content += `- ${result.scenarioId} - ${result.scenarioName}\n`;
      content += addExecutionIdentityLine(result);
      if (result.note) {
        content += `  > ${result.note}\n`;
      }
      if (result.screenshot) {
        content += `  > Screenshot: ${result.screenshot}\n`;
      }
    }
    content += '\n';
  }

  if (blocked.length > 0) {
    content += '### Blocked\n';
    for (const result of blocked) {
      content += `- ${result.scenarioId} - ${result.scenarioName}\n`;
      content += addExecutionIdentityLine(result);
      if (result.note) {
        content += `  > ${result.note}\n`;
      }
    }
    content += '\n';
  }

  fs.writeFileSync(markdownFilename, content);

  const jsonReport: TestReportJson = {
    area,
    date,
    summary: buildReportSummary(results),
    results
  };
  fs.writeFileSync(jsonFilename, JSON.stringify(jsonReport, null, 2));

  console.log(`\n  Report saved: ${area}-${date}.md`);
  console.log(`  JSON report saved: ${area}-${date}.json`);
}
