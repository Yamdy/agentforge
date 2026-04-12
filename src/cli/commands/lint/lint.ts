import * as p from '@clack/prompts';
import pc from 'picocolors';
import { join } from 'node:path';
import { fileService } from '../../services/file.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_DIR } from '../../utils/constants.js';

interface LintOptions {
  dir?: string;
  fix?: boolean;
}

export async function lint(options: LintOptions = {}): Promise<void> {
  const dir = options.dir || DEFAULT_DIR;
  const s = p.spinner();

  try {
    s.start('Linting AgentForge project...');

    const issues: string[] = [];

    const entryFile = join(dir, 'index.ts');
    if (!fileService.exists(entryFile)) {
      issues.push(`Entry file not found: ${entryFile}`);
    }

    const agentDir = join(dir, 'agents');
    if (!fileService.exists(agentDir)) {
      issues.push(`Agents directory not found: ${agentDir}`);
    }

    const workflowDir = join(dir, 'workflows');
    if (!fileService.exists(workflowDir)) {
      issues.push(`Workflows directory not found: ${workflowDir}`);
    }

    s.stop('Lint complete!');

    if (issues.length === 0) {
      p.note(`
        ${pc.green('No issues found!')}

        Your AgentForge project looks good.
      `);
    } else {
      console.log(pc.yellow('\nIssues found:'));
      issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });

      if (options.fix) {
        console.log(pc.cyan('\nAuto-fix is not implemented yet.'));
      }
    }
  } catch (err) {
    s.stop(pc.inverse(' Lint failed '));
    logger.error('Lint failed:', err);
  }
}
