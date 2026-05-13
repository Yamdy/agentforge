import type { PipelineContext, SubAgentConfig, SubAgentResult, Tool, ToolDefinition, Tracer } from '@agentforge/sdk';
import { Agent } from './agent.js';
import type { AgentRunResult } from './agent.js';

interface SubAgentParentContext {
  model: string;
  tools: ToolDefinition[];
  eventBus?: { emit: (event: string, data: unknown) => void };
  tracer?: Tracer;
  getSessionState?: () => Record<string, unknown>;
}

export function createSubAgentTool(
  config: SubAgentConfig,
  parent: SubAgentParentContext,
): ToolDefinition {
  const tool: Tool<{ task: string }, string> = {
    name: config.name,
    description: config.description ?? `Sub-agent: ${config.name}`,
    inputSchema: config.inputSchema ?? {},

    async execute(input: { task: string }): Promise<string> {
      parent.eventBus?.emit('task:start', { name: config.name, input });

      try {
        const childModel = config.model ?? parent.model;
        const childTools = config.tools ?? parent.tools;

        const childAgent = new Agent({
          model: childModel,
          systemPrompt: config.systemPrompt,
          tools: childTools,
          maxIterations: config.maxIterations,
        }, { tracer: parent.tracer });

        if (config.contextPolicy === 'inherit' && parent.getSessionState) {
          const parentState = parent.getSessionState();
          childAgent.use({
            stage: 'prepareStep',
            execute: async (ctx: PipelineContext) => ({
              ...ctx,
              session: { ...ctx.session, ...parentState },
            }),
          });
        }

        if (config.contextPolicy === 'summary-only' && parent.getSessionState) {
          const parentState = parent.getSessionState();
          const summary = summarizeSessionState(parentState);
          childAgent.use({
            stage: 'prepareStep',
            execute: async (ctx: PipelineContext) => ({
              ...ctx,
              session: { ...ctx.session, parentContextSummary: summary },
            }),
          });
        }

        const runResult = await childAgent.run(input.task);

        const result: SubAgentResult = {
          response: runResult.response,
          tokenUsage: runResult.tokenUsage,
          sessionId: runResult.sessionId,
        };

        parent.eventBus?.emit('task:end', { name: config.name, result });

        return runResult.response;
      } catch (err) {
        const errorSummary = `Sub-agent "${config.name}" failed: ${err instanceof Error ? err.message : String(err)}`;
        parent.eventBus?.emit('task:end', {
          name: config.name,
          error: errorSummary,
        });
        return errorSummary;
      }
    },
  };

  return tool as ToolDefinition;
}

function summarizeSessionState(state: Record<string, unknown>): string {
  const history = state.messageHistory as Array<{ role: string; content: string }> | undefined;
  if (!history || !Array.isArray(history)) return '';
  return history
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
}
