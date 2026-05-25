import { describe, it, expect } from 'vitest';
import { httpTool } from '../src/http.js';
import { resolveRequireApproval } from '@primo-ai/sdk';
import type { Tool } from '@primo-ai/sdk';

describe('httpTool conditional requireApproval', () => {
  it('should use a function for requireApproval', () => {
    expect(typeof httpTool.requireApproval).toBe('function');
  });

  it('should NOT require approval for GET method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'GET' })).toBe(false);
  });

  it('should NOT require approval for HEAD method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'HEAD' })).toBe(false);
  });

  it('should require approval for POST method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'POST' })).toBe(true);
  });

  it('should require approval for PUT method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'PUT' })).toBe(true);
  });

  it('should require approval for PATCH method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'PATCH' })).toBe(true);
  });

  it('should require approval for DELETE method', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'DELETE' })).toBe(true);
  });

  it('should NOT require approval when no method is specified (defaults to GET)', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com' })).toBe(false);
  });

  it('should handle lowercase method names', () => {
    const fn = httpTool.requireApproval as (input: any) => boolean;
    expect(fn({ url: 'https://example.com', method: 'post' })).toBe(true);
    expect(fn({ url: 'https://example.com', method: 'get' })).toBe(false);
  });
});

describe('resolveRequireApproval helper', () => {
  it('returns false when requireApproval is undefined', () => {
    const tool = { name: 'test', requireApproval: undefined } as unknown as Tool;
    expect(resolveRequireApproval(tool, {})).toBe(false);
  });

  it('returns the boolean value when requireApproval is a boolean', () => {
    const toolTrue = { name: 'test', requireApproval: true } as unknown as Tool;
    const toolFalse = { name: 'test', requireApproval: false } as unknown as Tool;
    expect(resolveRequireApproval(toolTrue, {})).toBe(true);
    expect(resolveRequireApproval(toolFalse, {})).toBe(false);
  });

  it('calls the function with input when requireApproval is a function', () => {
    const tool = {
      name: 'test',
      requireApproval: (input: any) => input.dangerous === true,
    } as unknown as Tool;
    expect(resolveRequireApproval(tool, { dangerous: true })).toBe(true);
    expect(resolveRequireApproval(tool, { dangerous: false })).toBe(false);
  });

  it('works with httpTool and GET input', () => {
    expect(resolveRequireApproval(httpTool, { url: 'https://example.com', method: 'GET' })).toBe(false);
  });

  it('works with httpTool and POST input', () => {
    expect(resolveRequireApproval(httpTool, { url: 'https://example.com', method: 'POST' })).toBe(true);
  });
});
