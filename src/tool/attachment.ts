// ========== Tool Attachment Types ==========

/**
 * File attachment for tool results.
 *
 * Supports:
 * - Images (PNG, JPEG, etc.)
 * - PDFs
 * - Other binary content
 */
export interface Attachment {
  /** MIME type (e.g., 'image/png', 'application/pdf') */
  contentType: string;

  /** Optional filename */
  name?: string;

  /** Base64-encoded content */
  content: string;

  /** Optional URL for external reference */
  url?: string;
}

/**
 * Create an image attachment from Buffer or Base64 string.
 *
 * @param content - Image content (Buffer or Base64 string)
 * @param name - Optional filename
 * @param contentType - MIME type (defaults to 'image/png')
 * @returns Attachment
 */
export function imageAttachment(
  content: Buffer | string,
  name?: string,
  contentType: string = 'image/png'
): Attachment {
  const base64Content = Buffer.isBuffer(content) ? content.toString('base64') : content;
  return {
    contentType,
    name,
    content: base64Content,
  };
}

/**
 * Create a PDF attachment from Buffer.
 *
 * @param content - PDF content as Buffer
 * @param name - Optional filename
 * @returns Attachment
 */
export function pdfAttachment(content: Buffer, name?: string): Attachment {
  return {
    contentType: 'application/pdf',
    name,
    content: content.toString('base64'),
  };
}

/**
 * Create a text attachment.
 *
 * @param content - Text content
 * @param name - Optional filename
 * @returns Attachment
 */
export function textAttachment(content: string, name?: string): Attachment {
  return {
    contentType: 'text/plain',
    name,
    content: Buffer.from(content).toString('base64'),
  };
}

/**
 * Create a JSON attachment.
 *
 * @param content - JSON object or string
 * @param name - Optional filename
 * @returns Attachment
 */
export function jsonAttachment(content: Record<string, unknown> | string, name?: string): Attachment {
  const jsonString = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return {
    contentType: 'application/json',
    name,
    content: Buffer.from(jsonString).toString('base64'),
  };
}