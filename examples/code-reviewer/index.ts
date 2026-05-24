/**
 * Code Reviewer - Main Entry Point
 * 
 * This module demonstrates how to create a production-ready code reviewer
 * agent using the AgentForge framework.
 * 
 * Features demonstrated:
 * - Config-driven agent creation (Markdown config)
 * - Custom tool registration
 * - Streaming responses with RxJS
 * - Optional Workflow orchestration
 * - CLI interface
 */

import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import { Agent } from '../../src/agent/index.js';
import { AIAdapter } from '../../src/adapters/ai.js';
import { InMemoryHistory } from '../../src/history.js';
import { ToolRegistry } from '../../src/registry.js';
import { BuiltinTools } from '../../src/tools/builtin/index.js';
import { createLogger } from '../../src/logger/index.js';
import { codeReviewerTools } from './tools/index.js';
import { runAgentDrivenReview } from './workflow.js';

const log = createLogger('code-reviewer');

/**
 * Configuration for the code reviewer
 */
export interface CodeReviewerConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxSteps?: number;
  temperature?: number;
}

/**
 * Create a code reviewer agent
 * 
 * This demonstrates both approaches:
 * 1. Using the AgentFactory with config (recommended)
 * 2. Manual construction with custom tools
 */
export async function createCodeReviewer(
  config: CodeReviewerConfig = {}
): Promise<Agent> {
  // Get API configuration from environment or config
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.DOUBAO_API_KEY || '';
  const baseURL = config.baseURL || process.env.DOUBAO_BASE_URL || '';
  const model = config.model || process.env.MODEL || 'gpt-4o';

  if (!apiKey) {
    log.warn('No API key configured. Set OPENAI_API_KEY or DOUBAO_API_KEY environment variable.');
  }

  // Create adapter
  const adapter = new AIAdapter({
    model,
    apiKey,
    baseURL,
    useTools: true,
  });

  // Create history manager
  const history = new InMemoryHistory();

  // Create tool registry and register tools
  const registry = new ToolRegistry();
  
  // Register built-in tools (read, ls, grep, find, glob, etc.)
  registry.register(BuiltinTools);
  
  // Register custom code reviewer tools
  registry.register(codeReviewerTools);

  // Bridge tools to adapter (required step!)
  adapter.setTools(registry.list());

  // Create agent with system prompt
  const agent = new Agent(adapter, history, registry, {
    maxSteps: config.maxSteps ?? 25,
    systemPrompt: `You are an expert code reviewer assistant.

Your role is to help developers understand and improve their codebase by providing comprehensive code reviews.

You have access to specialized analysis tools:
- analyze_structure: Analyze project organization and file structure
- analyze_quality: Detect code quality issues and anti-patterns  
- analyze_security: Scan for security vulnerabilities

You also have standard tools: read, ls, grep, find, glob for exploring code files.

When reviewing code:
1. First, use ls and analyze_structure to understand project organization
2. Then use analyze_quality to scan for code quality issues
3. Use analyze_security to check for vulnerabilities
4. Finally, compile a comprehensive review report in Markdown format

Be thorough but concise. Format output clearly with:
- Executive Summary with overall assessment
- Structure Analysis section
- Code Quality section (with severity ratings)
- Security Analysis section (with severity ratings)
- Recommendations section

Rate severity: 🔴 Critical, 🟠 High, 🟡 Warning, 🟢 Info`,
  });

  log.info('Code reviewer agent created', { model, toolCount: registry.list().length });
  return agent;
}

/**
 * Review a project and return a structured report
 */
export async function reviewProject(
  agent: Agent,
  projectPath: string,
  onProgress?: (event: { type: string; message: string }) => void
): Promise<string> {
  // Validate path
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  if (!fs.statSync(projectPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${projectPath}`);
  }

  log.info('Starting code review', { projectPath });

  return runAgentDrivenReview(agent, projectPath, onProgress);
}

/**
 * Interactive CLI mode
 */
export async function runInteractive(
  projectPath?: string,
  config: CodeReviewerConfig = {}
): Promise<void> {
  const agent = await createCodeReviewer(config);

  console.log('\n🔍 Code Reviewer - AI-Powered Code Analysis\n');
  console.log(`Model: ${config.model || 'gpt-4o'}`);
  console.log('Tools: read, ls, grep, find, glob, analyze_structure, analyze_quality, analyze_security\n');

  if (projectPath) {
    // Single review mode
    console.log(`Reviewing: ${projectPath}\n`);
    console.log('─'.repeat(60));
    
    try {
      const report = await reviewProject(agent, projectPath, (event) => {
        if (event.type === 'tool') {
          console.log(`\n⚙️  ${event.message}`);
        }
      });
      
      console.log('\n' + '─'.repeat(60));
      console.log('\n📊 Review Report:\n');
      console.log(report);
    } catch (err) {
      console.error('\n❌ Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  // Interactive mode - prompt for project path
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askPath = () => {
    rl.question('📁 Enter project path to review (or "quit" to exit): ', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      if (!trimmed) {
        askPath();
        return;
      }

      try {
        console.log('\n🔍 Analyzing project...\n');
        const report = await reviewProject(agent, trimmed, (event) => {
          if (event.type === 'tool') {
            process.stdout.write(`\n⚙️  ${event.message}`);
          }
        });
        
        console.log('\n\n📊 Review Report:\n');
        console.log(report);
        console.log('\n' + '─'.repeat(60) + '\n');
      } catch (err) {
        console.error('\n❌ Error:', err instanceof Error ? err.message : String(err));
      }

      askPath();
    });
  };

  askPath();
}

// Export for use as a module
export { codeReviewerTools };
