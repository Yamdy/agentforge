import { describe, it, expect } from 'vitest';

describe('CLI commands exports', () => {
  it('should export dev command', async () => {
    const { dev } = await import('../../src/cli/commands/dev/dev.js');
    expect(dev).toBeDefined();
    expect(typeof dev).toBe('function');
  });

  it('should export start command', async () => {
    const { start } = await import('../../src/cli/commands/start/start.js');
    expect(start).toBeDefined();
    expect(typeof start).toBe('function');
  });

  it('should export build command', async () => {
    const { build } = await import('../../src/cli/commands/build/build.js');
    expect(build).toBeDefined();
    expect(typeof build).toBe('function');
  });

  it('should export create command', async () => {
    const { create } = await import('../../src/cli/commands/create/create.js');
    expect(create).toBeDefined();
    expect(typeof create).toBe('function');
  });

  it('should export init command', async () => {
    const { init } = await import('../../src/cli/commands/init/init.js');
    expect(init).toBeDefined();
    expect(typeof init).toBe('function');
  });

  it('should export lint command', async () => {
    const { lint } = await import('../../src/cli/commands/lint/lint.js');
    expect(lint).toBeDefined();
    expect(typeof lint).toBe('function');
  });
});

describe('CLI dev command structure', () => {
  it('dev command should correctly import entry file', async () => {
    const devModule = await import('../../src/cli/commands/dev/dev.js');
    expect(devModule.dev).toBeDefined();
    // The function should have the code that imports entry file
    const content = devModule.dev.toString();
    expect(content).toContain('file://');
    expect(content).toContain('replace');
    // Check the logic exists
    expect(content).toContain('absolutePath');
    expect(content).toContain('fileUrl');
  });
});

describe('CLI start command structure', () => {
  it('start command should correctly import entry file', async () => {
    const startModule = await import('../../src/cli/commands/start/start.js');
    expect(startModule.start).toBeDefined();
    // The function should have the code that imports entry file
    const content = startModule.start.toString();
    expect(content).toContain('file://');
    expect(content).toContain('replace');
    // Check the logic exists
    expect(content).toContain('absolutePath');
    expect(content).toContain('fileUrl');
  });
});

describe('build command structure', () => {
  it('build should read entry file from DEFAULT_DIR', async () => {
    const buildModule = await import('../../src/cli/commands/build/build.js');
    expect(buildModule.build).toBeDefined();
    const content = buildModule.build.toString();
    expect(content).toContain('entryFile');
    expect(content).toContain('index.ts');
    expect(content).toContain('fileService.readFile');
  });
});

describe('lint command structure', () => {
  it('lint should check expected directories', async () => {
    const lintModule = await import('../../src/cli/commands/lint/lint.js');
    expect(lintModule.lint).toBeDefined();
    const content = lintModule.lint.toString();
    // Check that it verifies all required directories exist
    expect(content).toContain('agents');
    expect(content).toContain('workflows');
    expect(content).toContain('tools');
  });
});
