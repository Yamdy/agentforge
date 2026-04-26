import Handlebars from 'handlebars';
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// String case converters
export function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

// Handlebars helpers - registered once on module load
let helpersRegistered = false;
export function registerHelpers(): void {
  if (helpersRegistered) return;
  Handlebars.registerHelper('pascalCase', toPascalCase);
  Handlebars.registerHelper('camelCase', toCamelCase);
  Handlebars.registerHelper('kebabCase', toKebabCase);
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) =>
    args.slice(0, -1).every(Boolean)
  );
  Handlebars.registerHelper('or', (...args: unknown[]) =>
    args.slice(0, -1).some(Boolean)
  );
  helpersRegistered = true;
}

export function renderTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  registerHelpers();
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

export function renderTemplateFile(
  templatePath: string,
  data: Record<string, unknown>
): string {
  const templateContent = readFileSync(templatePath, 'utf-8');
  return renderTemplate(templateContent, data);
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// Atomic directory operations for safe rollback
export function createTempDir(prefix: string = 'agentforge-'): string {
  const tempPath = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tempPath, { recursive: true });
  return tempPath;
}

export function atomicMove(tempDir: string, targetDir: string): void {
  // If target exists and is empty, remove it first
  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir);
    if (entries.length === 0) {
      rmSync(targetDir, { recursive: true, force: true });
    } else {
      throw new Error(
        `Target directory ${targetDir} is not empty. Use --force to overwrite.`
      );
    }
  }

  try {
    // Try atomic rename (works on same filesystem)
    renameSync(tempDir, targetDir);
  } catch {
    // Cross-device: copy then remove
    cpDirSync(tempDir, targetDir);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function cpDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      cpDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export function cleanupTempDir(tempDir: string): void {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
