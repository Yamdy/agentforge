/**
 * Code Reviewer Custom Tools
 * 
 * Exports all custom analysis tools for the code reviewer agent.
 */

export { AnalyzeStructureTool } from './analyze-structure.js';
export { AnalyzeQualityTool } from './analyze-quality.js';
export { AnalyzeSecurityTool } from './analyze-security.js';

import { AnalyzeStructureTool } from './analyze-structure.js';
import { AnalyzeQualityTool } from './analyze-quality.js';
import { AnalyzeSecurityTool } from './analyze-security.js';

/**
 * All custom code reviewer tools
 */
export const codeReviewerTools = [
  AnalyzeStructureTool,
  AnalyzeQualityTool,
  AnalyzeSecurityTool,
];
