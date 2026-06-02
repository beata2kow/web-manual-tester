/**
 * Web Manual Tester - Function Exports
 * 
 * These functions support the web-manual-tester agent by providing:
 * - XLSX parsing and scenario categorization
 * - Environment configuration reading
 * - User capability detection
 * - Test ordering logic
 * - Mailosaur OTP retrieval
 * - Test data creation guidance
 */

export {
  detectPageApplicationError,
  formatApplicationErrorNote,
  APPLICATION_ERROR_PHRASES,
  APPLICATION_ERROR_PATTERNS,
} from './pageHealth';

export {
  verifyStepGoal,
  verifyOpenUploadModalGoal,
  verifySuccessToastGoal,
  verifyStatusLabelGoal,
  tryAdvanceObviousModal,
  isNavigationShapedText,
  shouldInferUploadAfterAction,
} from './goalVerification';

export {
  getCrateListState,
  tryInterpretCratesListStep,
  verifyCrateContentGoal,
} from './crateContext';

export { tryFormActionFromText } from './formActions';

export { verifyDomainGoal } from './domainGoals';

export {
  classifyPrecondition,
  isSkippablePreconditionText,
  isOtpPreconditionText,
  type PreconditionKind,
  type PreconditionResult
} from './stepPreconditions';

export {
  parseXlsxScenarios,
  groupScenariosByArea,
  getExecutionPriority,
  type TestScenario,
  type TestStep,
  type FeatureArea,
  type ActionType
} from './parseXlsxScenarios';

export {
  readConfig,
  getBaseUrl,
  getIdentityUrl,
  getProduceHeader,
  getOtpConfig,
  type EnvironmentConfig,
  type UserConfig,
  type OtpConfig
} from './readConfig';

export {
  getAvailableUsers,
  getUsersByCapability,
  suggestUserForScenario,
  getNextFallbackUser,
  UserSessionMemory,
  userSessionMemory,
  type UserWithCapabilities,
  type UserCapability
} from './getAvailableUsers';

export {
  orderScenariosWithinArea,
  orderAllScenarios,
  createExecutionPlan,
  printExecutionPlan,
  type ExecutionPlan
} from './orderScenarios';

export {
  getMailosaurOtp,
  waitForOtp
} from './getMailosaurOtp';

export {
  configureRepoModuleResolution,
  getRepoRootFromArgs,
  requireRepoModule,
  resolveDefaultWorkbookPath,
  resolveRepoRoot,
  RepoRootNotFoundError
} from './resolveRepoModule';

export {
  executeScenarioSteps,
  executeScenarioStepsWithStrictRetry,
  type StepExecutionResult,
  type StepExecutorDeps,
  type StepExecutorPage,
  type MenuPath,
  type NavigationTarget
} from './executeScenarioSteps';

export { LoginManager, type LoginManagerDeps } from './loginManager';

export {
  generateReport,
  type TestResult,
  type TestReportJson,
  type TestReportSummary
} from './reportWriter';

export {
  createCrateOrder,
  createGrower,
  createOrderOrder,
  suggestPrerequisiteScenario,
  getRequiredDataType,
  type TestDataResult
} from './createTestData';
