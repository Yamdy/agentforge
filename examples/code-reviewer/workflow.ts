/**
 * Code Reviewer Workflow
 * 
 * Demonstrates how to orchestrate code review using the Agent.
 * The Agent orchestrates itself using its tools - simpler than Workflow.
 */

import type { Agent } from '../../src/agent/index.js';
import type { StreamEvent } from '../../src/types.js';

/**
 * Input for the code review
 */
export interface CodeReviewInput {
  projectPath: string;
  projectName: string;
}

/**
 * Agent-driven review (recommended approach)
 * 
 * Instead of using Workflow steps, let the Agent orchestrate itself
 * using its tools. This is simpler and more flexible.
 */
export async function runAgentDrivenReview(
  agent: Agent,
  projectPath: string,
  onProgress?: (event: { type: string; message: string }) => void
): Promise<string> {
  const prompt = `You are a code reviewer. Please perform a comprehensive code review of the project at "${projectPath}".

Follow these steps:
1. Use analyze_structure to understand the project organization
2. Use analyze_quality to check for code quality issues  
3. Use analyze_security to scan for security vulnerabilities
4. Compile a final review report in Markdown format

The report should include:
- Executive Summary with overall score (0-100)
- Structure Analysis section
- Code Quality section (with severity ratings)
- Security Analysis section (with severity ratings)
- Recommendations section

Be thorough but concise. Focus on actionable insights.`;

  return new Promise((resolve, reject) => {
    let fullResponse = '';
    
    agent.runStream(prompt).subscribe({
      next: (event: StreamEvent) => {
        if (event.type === 'text') {
          fullResponse += event.content;
          onProgress?.({ type: 'text', message: event.content });
        } else if (event.type === 'tool_call_start') {
          onProgress?.({ type: 'tool', message: `Running ${event.name}...` });
        }
      },
      complete: () => {
        resolve(fullResponse);
      },
      error: (err) => {
        reject(err);
      },
    });
  });
}