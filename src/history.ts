import { HistoryManager, validateMessage, Message, ToolCallResult } from './types';

interface HistoryEntry {
  type: 'message' | 'toolResult';
  message?: Message;
  toolResult?: ToolCallResult;
  order: number;
}

export class InMemoryHistory implements HistoryManager {
  private entries: HistoryEntry[] = [];
  private order = 0;

  add(role: 'system' | 'user' | 'assistant' | 'tool', content: string): void {
    this.entries.push({
      type: 'message',
      message: validateMessage({ role, content }),
      order: this.order++,
    });
  }

  addToolResult(
    toolCallId: string,
    toolName: string,
    result: string,
    toolArguments?: string
  ): void {
    this.entries.push({
      type: 'toolResult',
      toolResult: { toolCallId, toolName, result, toolArguments },
      order: this.order++,
    });
  }

  getToolResult(toolCallId: string): ToolCallResult | undefined {
    const entry = this.entries.find(
      (e) => e.type === 'toolResult' && e.toolResult?.toolCallId === toolCallId
    );
    return entry?.toolResult;
  }

  getMessages(): Message[] {
    return this.entries.map((entry) => {
      if (entry.type === 'message' && entry.message) {
        return entry.message;
      }
      if (entry.type === 'toolResult' && entry.toolResult) {
        return {
          role: 'tool' as const,
          content: entry.toolResult.result,
          toolCallId: entry.toolResult.toolCallId,
          toolName: entry.toolResult.toolName,
          toolArguments: entry.toolResult.toolArguments,
        };
      }
      return { role: 'user' as const, content: '' };
    });
  }

  clear(): void {
    this.entries = [];
    this.order = 0;
  }
}
