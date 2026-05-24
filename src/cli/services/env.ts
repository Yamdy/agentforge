import { fileService } from './file.js';
import { logger } from '../utils/logger.js';

export class EnvService {
  private fileService = fileService;

  loadEnvFile(envPath: string = '.env'): Map<string, string> {
    const env = new Map<string, string>();

    if (!this.fileService.exists(envPath)) {
      logger.debug(`Env file not found: ${envPath}`);
      return env;
    }

    const content = this.fileService.readFile(envPath);
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex > 0) {
          const key = trimmed.slice(0, equalsIndex).trim();
          const value = trimmed
            .slice(equalsIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          env.set(key, value);
        }
      }
    }

    return env;
  }

  writeEnvExample(envVars: Record<string, string>): void {
    const lines = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
    this.fileService.writeFile('.env.example', lines.join('\n') + '\n');
  }
}

export const envService = new EnvService();
