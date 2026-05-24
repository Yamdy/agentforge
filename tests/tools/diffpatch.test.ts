import { describe, it, expect } from 'vitest';
import { diffpatchTool } from '../../src/tools/builtin/diffpatch';

describe('diffpatch tool', () => {
  it('should have correct name and description', () => {
    expect(diffpatchTool.name).toBe('diff_edit');
    expect(diffpatchTool.description).toContain('targeted edit');
  });

  it('should require filePath and replacement in the schema', () => {
    const shape = diffpatchTool.parameters.shape;
    expect(shape.filePath).toBeDefined();
    expect(shape.replacement).toBeDefined();
  });

  it('should have optional startLine and endLine in the schema', () => {
    const shape = diffpatchTool.parameters.shape;
    expect(shape.startLine).toBeDefined();
    expect(shape.endLine).toBeDefined();
  });
});
