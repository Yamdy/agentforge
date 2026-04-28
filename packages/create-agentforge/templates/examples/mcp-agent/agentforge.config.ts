/**
 * MCP Agent - Agent connected to MCP servers
 *
 * Demonstrates how to connect an agent to Model Context Protocol (MCP)
 * servers for extended tool capabilities.
 *
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { adapter } from './src/llm/adapter.js';
import { mcpClient } from './src/mcp/client.js';

export default defineConfig({
  name: 'mcp-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Maximum steps for MCP tool calls
  maxSteps: 20,

  // LLM adapter
  llm: adapter,

  // MCP integration — connects to external tool servers
  mcp: mcpClient,

  // System prompt instructs the agent to use MCP tools
  systemPrompt: `You are an agent connected to MCP (Model Context Protocol) servers.
You have access to tools provided by these servers.
When you need to perform actions, use the available MCP tools.
Always explain what you're doing and which tool you're using.`,
});