import { HistoryManager, validateMessage, Message, ToolResult } from './types';

export class InMemoryHistory implements HistoryManager {
  private messages: Message[] = [];
  private toolResults: ToolResult[] = [];

  add(role: 'user' | 'assistant', content: string): void {
    this.messages.push(validateMessage({ role, content }));
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.toolResults.push({ toolCallId, toolName, result });
  }

  getToolResult(toolCallId: string): ToolResult | undefined {
    return this.toolResults.find(tr => tr.toolCallId === toolCallId);
  }

  getMessages(): Message[] {
    const result: Message[] = [];
    for (const msg of this.messages) {
      result.push(msg);
    }
    for (const tr of this.toolResults) {
      result.push({
        role: 'user',
        content: `[TOOL_CALL_RESULT] tool_name=${tr.toolName} tool_call_id=${tr.toolCallId} result="${tr.result}"`,
      });
    }
    return result;
  }

  clear(): void {
    this.messages = [];
    this.toolResults = [];
  }
}
