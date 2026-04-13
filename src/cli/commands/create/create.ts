import * as p from '@clack/prompts';
import pc from 'picocolors';
import { execa } from 'execa';
import { fileService } from '../../services/file.js';
import { detectPackageManager } from '../../utils/package-manager.js';
import { logger } from '../../utils/logger.js';
import { TEMPLATES } from '../../utils/template.js';
import { DEFAULT_DIR, LLM_PROVIDERS } from '../../utils/constants.js';
import type { LLMProvider, TemplateType } from '../../utils/constants.js';
import {
  createMastraDir,
  writeIndexFile,
  writeAPIKey,
  createComponentsDir,
  getAPIKey,
} from '../init/utils.js';

interface CreateOptions {
  default?: boolean;
  dir?: string;
  template?: string;
  noExample?: boolean;
  noGit?: boolean;
}

export async function create(projectName?: string, options: CreateOptions = {}): Promise<void> {
  const s = p.spinner();

  try {
    let name: string;
    let template: TemplateType;
    let provider: LLMProvider;
    let addExample: boolean;
    let initGit: boolean;
    let targetDir: string;

    if (options.default) {
      name = projectName || 'my-agentforge-app';
      template = 'basic';
      provider = 'openai';
      addExample = true;
      initGit = true;
      targetDir = options.dir || name;
    } else {
      name =
        projectName ||
        ((await p.text({
          message: 'What is your project name?',
          placeholder: 'my-agentforge-app',
          validate: (value) => {
            if (!value) return 'Please enter a project name';
            return;
          },
        })) as string);

      if (p.isCancel(name)) return;

      template = (options.template ||
        (await p.select({
          message: 'Choose a project template',
          options: [
            { value: 'basic', label: 'Basic - Minimal setup' },
            { value: 'workflow', label: 'Workflow - With workflow examples' },
            { value: 'full', label: 'Full - Complete feature set' },
          ],
        }))) as TemplateType;

      if (p.isCancel(template)) return;

      provider = (await p.select({
        message: 'Choose your default LLM provider',
        options: LLM_PROVIDERS.map((p) => ({ value: p, label: p })),
      })) as LLMProvider;

      if (p.isCancel(provider)) return;

      const addExampleResult = options.noExample
        ? false
        : await p.confirm({
            message: 'Include example code?',
            initialValue: true,
          });

      if (p.isCancel(addExampleResult)) return;
      addExample = addExampleResult as boolean;

      const initGitResult = options.noGit
        ? false
        : await p.confirm({
            message: 'Initialize git repository?',
            initialValue: true,
          });

      if (p.isCancel(initGitResult)) return;
      initGit = initGitResult as boolean;

      targetDir = options.dir || name;
    }

    s.start('Creating project...');

    //    const originalDir = process.cwd();

    if (targetDir !== '.') {
      fileService.ensureDir(targetDir);
      process.chdir(targetDir);
    }

    const result = await createMastraDir(DEFAULT_DIR);

    if (!result.ok) {
      s.stop(pc.inverse(' AgentForge already initialized '));
      return;
    }

    const dirPath = result.dirPath;

    await Promise.all([
      writeIndexFile({
        dirPath,
        addExample,
        addWorkflow: template === 'workflow' || template === 'full',
        addAgent: template === 'full',
      }),
      createComponentsDir(dirPath, 'agent'),
      createComponentsDir(dirPath, 'workflow'),
      createComponentsDir(dirPath, 'tool'),
      writeAPIKey({ provider }),
    ]);

    fileService.writeFile(
      'package.json',
      JSON.stringify(
        {
          name,
          version: '0.1.0',
          type: 'module',
          scripts: {
            dev: 'agentforge dev',
            build: 'agentforge build',
            start: 'agentforge start',
          },
          dependencies: {
            agentforge: '^0.1.0',
          },
        },
        null,
        2
      )
    );

    fileService.writeFile('.gitignore', TEMPLATES.gitignore);

    if (initGit) {
      s.message('Initializing git...');
      try {
        await execa('git', ['init'], { stdio: 'inherit' });
      } catch {
        logger.warn('Git initialization failed, skipping...');
      }
    }

    s.stop('Project created successfully!');

    const manager = await detectPackageManager();
    p.note(`
      ${pc.green('Project created successfully!')}

      Next steps:
        ${pc.cyan(`cd ${targetDir}`)}
        ${pc.cyan(`${manager} install`)}
        ${pc.cyan(`${manager} run dev`)}

      Add your ${pc.cyan(await getAPIKey(provider))} as an environment variable
      in your ${pc.cyan('.env')} file
    `);
  } catch (err) {
    s.stop(pc.inverse('An error occurred while creating the project'));
    console.error(err);
  }
}
