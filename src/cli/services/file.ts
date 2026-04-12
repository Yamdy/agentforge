import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class FileService {
  ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  writeFile(filePath: string, content: string): void {
    const dir = join(filePath, '..');
    this.ensureDir(dir);
    writeFileSync(filePath, content, 'utf-8');
  }

  readFile(filePath: string): string {
    return readFileSync(filePath, 'utf-8');
  }

  exists(filePath: string): boolean {
    return existsSync(filePath);
  }
}

export const fileService = new FileService();
