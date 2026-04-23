// ========== Tool Module Entry ==========

// Types
export type { ToolContext, MetadataInput, AskInput, AskResult } from './context';
export type { ToolResult } from './result';
export type { Attachment } from './attachment';

// Helper functions
export { createMockToolContext } from './context';
export {
  textResult,
  truncatedResult,
  resultWithAttachments,
  errorResult,
} from './result';
export {
  imageAttachment,
  pdfAttachment,
  textAttachment,
  jsonAttachment,
} from './attachment';