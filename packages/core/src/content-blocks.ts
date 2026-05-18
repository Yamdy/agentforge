import type { ContentBlock, ToolCall } from '@primo-ai/sdk';

export function assembleContentBlocks(
  textParts: string[],
  toolCalls: ToolCall[],
  reasoning: string[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Merge reasoning parts into a single thinking block
  const reasoningText = reasoning.join('');
  if (reasoningText) {
    blocks.push({ type: 'thinking', text: reasoningText });
  }

  // Merge text parts into a single text block
  const textContent = textParts.join('');
  if (textContent) {
    blocks.push({ type: 'text', text: textContent });
  }

  // Each tool call is its own block
  for (const tc of toolCalls) {
    blocks.push({ type: 'tool-call', id: tc.id, name: tc.name, args: tc.args });
  }

  return blocks;
}

export function textContentFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function toolCallsFromBlocks(blocks: ContentBlock[]): ToolCall[] {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'tool-call' }> => b.type === 'tool-call')
    .map((b) => ({ id: b.id, name: b.name, args: b.args }));
}

export function reasoningFromBlocks(blocks: ContentBlock[]): string | undefined {
  const parts = blocks
    .filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.text);
  return parts.length > 0 ? parts.join('') : undefined;
}
