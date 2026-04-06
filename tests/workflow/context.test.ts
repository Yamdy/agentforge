import { describe, test, expect, beforeEach } from 'vitest';
import { WorkflowContextImpl } from '../../src/workflow/context.js';

describe('WorkflowContext', () => {
  let context: WorkflowContextImpl;

  beforeEach(() => {
    context = new WorkflowContextImpl();
  });

  test('should set and get results', () => {
    context.setResult('step1', { value: 42 });
    expect(context.getResult('step1')).toEqual({ value: 42 });
  });

  test('should return undefined for non-existent step', () => {
    expect(context.getResult('nonexistent')).toBeUndefined();
  });

  test('should set and get state', () => {
    context.setState({ key: 'value' });
    expect(context.getState()).toEqual({ key: 'value' });
  });

  test('should override existing state', () => {
    context.setState({ key1: 'value1' });
    context.setState({ key2: 'value2' });
    expect(context.getState()).toEqual({ key2: 'value2' });
  });
});
