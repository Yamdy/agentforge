import { fileService } from '../../services/file.js';
import { DEFAULT_DIR } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';

export interface InitOptions {
  directory?: string;
  provider?: string;
  modelName?: string;
  addExample?: boolean;
}

export async function createMastraDir(
  directory: string = DEFAULT_DIR
): Promise<{ ok: boolean; dirPath: string }> {
  const dirPath = directory;
  if (fileService.exists(dirPath)) {
    return { ok: false, dirPath };
  }
  fileService.ensureDir(dirPath);
  return { ok: true, dirPath };
}

export async function writeIndexFile(options: {
  dirPath: string;
  addExample: boolean;
  addWorkflow: boolean;
  addAgent: boolean;
}): Promise<void> {
  const { dirPath } = options;
  const content = `import { startServer } from 'agentforge';\n\nstartServer({ port: 4111 });\n`;
  fileService.writeFile(`${dirPath}/index.ts`, content);
  logger.success('Created index.ts');
}

export async function writeAPIKey(options: { provider: string; apiKey?: string }): Promise<void> {
  const envExampleContent = `# AgentForge Configuration\n\n# LLM Configuration\n${options.provider.toUpperCase()}_API_KEY=\nMODEL=\n`;
  fileService.writeFile('.env.example', envExampleContent);
  logger.success('Created .env.example');
}

export async function createComponentsDir(dirPath: string, component: string): Promise<void> {
  const componentDir = `${dirPath}/${component}s`;
  fileService.ensureDir(componentDir);
  logger.success(`Created ${component}s directory`);
}

export async function getAPIKey(provider: string): Promise<string> {
  return `${provider.toUpperCase()}_API_KEY`;
}
