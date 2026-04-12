import * as p from '@clack/prompts';
import pc from 'picocolors';
import { logger } from '../../utils/logger.js';
import { LLM_PROVIDERS, DEFAULT_DIR } from '../../utils/constants.js';
import type { LLMProvider } from '../../utils/constants.js';
import {
  createMastraDir,
  writeIndexFile,
  writeAPIKey,
  createComponentsDir,
  getAPIKey,
} from './utils.js';

interface InitOptions {
  default?: boolean;
  dir?: string;
  example?: boolean;
}

export async function init(options: InitOptions = {}): Promise<void> {
  const s = p.spinner();

  try {
    let directory: string;
    let provider: LLMProvider;
    let addExample: boolean;

    if (options.default) {
      directory = options.dir || DEFAULT_DIR;
      provider = 'openai';
      addExample = true;
    } else {
      directory =
        options.dir ||
        ((await p.text({
          message: 'Where do you want to put your AgentForge files?',
          placeholder: DEFAULT_DIR,
          initialValue: DEFAULT_DIR,
        })) as string);

      if (p.isCancel(directory)) return;

      provider = (await p.select({
        message: 'Choose your default LLM provider',
        options: LLM_PROVIDERS.map((p) => ({ value: p, label: p })),
      })) as LLMProvider;

      if (p.isCancel(provider)) return;

      const addExampleResult =
        options.example ??
        (await p.confirm({
          message: 'Include example code?',
          initialValue: true,
        }));

      if (p.isCancel(addExampleResult)) return;
      addExample = addExampleResult as boolean;
    }

    s.start('Initializing AgentForge...');

    const result = await createMastraDir(directory);

    if (!result.ok) {
      s.stop(pc.inverse(' AgentForge already initialized '));
      return;
    }

    const dirPath = result.dirPath;

    await Promise.all([
      writeIndexFile({
        dirPath,
        addExample,
        addWorkflow: true,
        addAgent: true,
      }),
      createComponentsDir(dirPath, 'agent'),
      createComponentsDir(dirPath, 'workflow'),
      createComponentsDir(dirPath, 'tool'),
      writeAPIKey({ provider }),
    ]);

    s.stop('AgentForge initialized successfully!');

    p.note(`
      ${pc.green('AgentForge initialized successfully!')}

      Add your ${pc.cyan(await getAPIKey(provider))} as an environment variable
      in your ${pc.cyan('.env')} file
    `);
  } catch (err) {
    s.stop(pc.inverse('An error occurred while initializing AgentForge'));
    console.error(err);
  }
}
