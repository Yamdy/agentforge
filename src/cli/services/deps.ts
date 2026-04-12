import { fileService } from './file.js';
import { detectPackageManager, installDependencies } from '../utils/package-manager.js';
import { logger } from '../utils/logger.js';

export class DepsService {
  private fileService = fileService;

  async checkDependencies(packages: string[]): Promise<'ok' | string[]> {
    try {
      const pkgJsonPath = 'package.json';
      if (!this.fileService.exists(pkgJsonPath)) {
        return packages;
      }

      const pkgJson = JSON.parse(this.fileService.readFile(pkgJsonPath));
      const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      const missing = packages.filter((pkg) => !allDeps[pkg]);

      return missing.length > 0 ? missing : 'ok';
    } catch {
      return packages;
    }
  }

  async installPackages(packages: string[], dev: boolean = false): Promise<void> {
    const manager = await detectPackageManager();
    logger.info(`Using ${manager} to install dependencies...`);
    await installDependencies(packages, manager, dev);
  }
}

export const depsService = new DepsService();
