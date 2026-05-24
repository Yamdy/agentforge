import { execa } from 'execa';
import { PACKAGE_MANAGERS } from './constants.js';
import type { PackageManager } from './constants.js';

export async function detectPackageManager(): Promise<PackageManager> {
  for (const manager of PACKAGE_MANAGERS) {
    try {
      await execa(manager, ['--version'], { timeout: 5000 });
      return manager;
    } catch {
      continue;
    }
  }
  return 'npm';
}

export async function installDependencies(
  packages: string[],
  manager: PackageManager = 'npm',
  dev: boolean = false
): Promise<void> {
  const args: string[] = [];

  switch (manager) {
    case 'npm':
      args.push('install');
      if (dev) args.push('--save-dev');
      break;
    case 'yarn':
      args.push('add');
      if (dev) args.push('--dev');
      break;
    case 'pnpm':
      args.push('add');
      if (dev) args.push('-D');
      break;
  }

  args.push(...packages);

  await execa(manager, args, { stdio: 'inherit' });
}
