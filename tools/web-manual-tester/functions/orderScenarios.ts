#!/usr/bin/env npx ts-node
/**
 * Order test scenarios logically within a feature area
 * Follows: view -> create -> edit -> approve -> reject -> cancel -> delete
 * Usage: npx ts-node libs/memory/agents/functions/orderScenarios.ts [scenarios-json-file]
 */

import * as fs from 'fs';
import { TestScenario, ActionType, FeatureArea, getExecutionPriority } from './parseXlsxScenarios';

const ACTION_ORDER: Record<ActionType, number> = {
  'view': 1,
  'create': 2,
  'edit': 3,
  'approve': 4,
  'reject': 5,
  'cancel': 6,
  'delete': 7,
  'other': 8
};

export function orderScenariosWithinArea(scenarios: TestScenario[]): TestScenario[] {
  return [...scenarios].sort((a, b) => {
    const orderA = ACTION_ORDER[a.actionType] || 99;
    const orderB = ACTION_ORDER[b.actionType] || 99;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    return a.name.localeCompare(b.name);
  });
}

export function orderAllScenarios(scenarios: TestScenario[]): TestScenario[] {
  const priority = getExecutionPriority();
  const grouped: Map<FeatureArea, TestScenario[]> = new Map();
  
  for (const scenario of scenarios) {
    const area = scenario.area;
    if (!grouped.has(area)) {
      grouped.set(area, []);
    }
    grouped.get(area)!.push(scenario);
  }
  
  const orderedScenarios: TestScenario[] = [];
  
  for (const area of priority) {
    const areaScenarios = grouped.get(area);
    if (areaScenarios && areaScenarios.length > 0) {
      const orderedAreaScenarios = orderScenariosWithinArea(areaScenarios);
      orderedScenarios.push(...orderedAreaScenarios);
    }
  }
  
  for (const [area, areaScenarios] of grouped) {
    if (!priority.includes(area) && areaScenarios.length > 0) {
      const orderedAreaScenarios = orderScenariosWithinArea(areaScenarios);
      orderedScenarios.push(...orderedAreaScenarios);
    }
  }
  
  return orderedScenarios;
}

export interface ExecutionPlan {
  totalScenarios: number;
  featureAreas: {
    area: FeatureArea;
    scenarios: TestScenario[];
    usesMailosaur: boolean;
    canParallelize: boolean;
  }[];
  serialAreas: FeatureArea[];
  parallelizableAreas: FeatureArea[];
}

export function createExecutionPlan(scenarios: TestScenario[]): ExecutionPlan {
  const ordered = orderAllScenarios(scenarios);
  const grouped: Map<FeatureArea, TestScenario[]> = new Map();
  
  for (const scenario of ordered) {
    if (!grouped.has(scenario.area)) {
      grouped.set(scenario.area, []);
    }
    grouped.get(scenario.area)!.push(scenario);
  }
  
  const featureAreas: ExecutionPlan['featureAreas'] = [];
  const serialAreas: FeatureArea[] = [];
  const parallelizableAreas: FeatureArea[] = [];
  
  const priority = getExecutionPriority();
  
  for (const area of priority) {
    const areaScenarios = grouped.get(area);
    if (!areaScenarios || areaScenarios.length === 0) continue;
    
    const usesMailosaur = areaScenarios.some(s => s.usesMailosaur);
    const canParallelize = !usesMailosaur;
    
    featureAreas.push({
      area,
      scenarios: areaScenarios,
      usesMailosaur,
      canParallelize
    });
    
    if (usesMailosaur) {
      serialAreas.push(area);
    } else {
      parallelizableAreas.push(area);
    }
  }
  
  return {
    totalScenarios: ordered.length,
    featureAreas,
    serialAreas,
    parallelizableAreas
  };
}

export function printExecutionPlan(plan: ExecutionPlan): void {
  console.log('=== Execution Plan ===\n');
  console.log(`Total scenarios: ${plan.totalScenarios}\n`);
  
  console.log('Feature areas (in execution order):');
  for (const area of plan.featureAreas) {
    const mailosaur = area.usesMailosaur ? ' [MAILOSAUR - SERIAL]' : '';
    console.log(`  ${area.area}: ${area.scenarios.length} scenarios${mailosaur}`);
    
    for (const scenario of area.scenarios) {
      console.log(`    - ${scenario.id}: ${scenario.name} [${scenario.actionType}]`);
    }
  }
  
  console.log('\n--- Parallelization Info ---');
  console.log(`Serial (Mailosaur): ${plan.serialAreas.join(', ') || 'none'}`);
  console.log(`Parallelizable: ${plan.parallelizableAreas.join(', ') || 'none'}`);
}

if (require.main === module) {
  const jsonPath = process.argv[2];
  
  if (!jsonPath) {
    console.log('Usage: npx ts-node orderScenarios.ts <scenarios-json-file>');
    console.log('');
    console.log('Expected JSON format: Array of TestScenario objects from parseXlsxScenarios');
    process.exit(1);
  }
  
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const scenarios: TestScenario[] = JSON.parse(content);
    
    const plan = createExecutionPlan(scenarios);
    printExecutionPlan(plan);
    
    console.log('\n=== Ordered Scenarios (JSON) ===');
    console.log(JSON.stringify(plan, null, 2));
  } catch (error) {
    console.error('Error ordering scenarios:', error);
    process.exit(1);
  }
}
