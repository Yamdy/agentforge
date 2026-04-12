export const DEFAULT_DIR = 'src/agentforge';
export const DEFAULT_PORT = 4111;
export const DEFAULT_HOST = 'localhost';
export const OUTPUT_DIR = '.agentforge/output';
export const TEMP_DIR = '.agentforge';

export const TEMPLATES = {
  BASIC: 'basic',
  WORKFLOW: 'workflow',
  FULL: 'full',
} as const;

export const LLM_PROVIDERS = ['openai', 'doubao', 'anthropic'] as const;

export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'] as const;

export type TemplateType = (typeof TEMPLATES)[keyof typeof TEMPLATES];
export type LLMProvider = (typeof LLM_PROVIDERS)[number];
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
