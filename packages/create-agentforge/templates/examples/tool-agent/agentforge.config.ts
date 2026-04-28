/**
 * Tool Agent - Agent with custom tools and filesystem access
 *
 * Demonstrates how to define custom tools with Zod schemas
 * and register them with the agent for function calling.
 *
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { z } from 'zod';
import { adapter } from './src/llm/adapter.js';

export default defineConfig({
  name: 'tool-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Maximum steps before forced termination
  maxSteps: 15,

  // LLM adapter
  llm: adapter,

  // Custom tools — the agent can call these during execution
  tools: {
    // Filesystem read tool
    readFile: {
      description: 'Read the contents of a file from the filesystem',
      parameters: z.object({
        path: z.string().describe('Absolute or relative path to the file'),
      }),
      execute: async (args: { path: string }) => {
        const { readFile } = await import('node:fs/promises');
        try {
          return await readFile(args.path, 'utf-8');
        } catch (error: unknown) {
          return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Filesystem write tool
    writeFile: {
      description: 'Write content to a file on the filesystem',
      parameters: z.object({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async (args: { path: string; content: string }) => {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        try {
          await mkdir(dirname(args.path), { recursive: true });
          await writeFile(args.path, args.content, 'utf-8');
          return `Successfully wrote to ${args.path}`;
        } catch (error: unknown) {
          return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // List directory contents
    listDir: {
      description: 'List files and directories at a given path',
      parameters: z.object({
        path: z.string().describe('Directory path to list'),
      }),
      execute: async (args: { path: string }) => {
        const { readdir, stat } = await import('node:fs/promises');
        try {
          const entries = await readdir(args.path);
          const results = await Promise.all(
            entries.map(async (name) => {
              const fullPath = `${args.path}/${name}`;
              try {
                const s = await stat(fullPath);
                return s.isDirectory() ? `${name}/` : name;
              } catch {
                return name;
              }
            })
          );
          return results.join('\n');
        } catch (error: unknown) {
          return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  },
});