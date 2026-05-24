import { ReadTool } from './read';
import { WriteTool } from './write';
import { LsTool } from './ls';
import { BashTool, BashToolExecutor } from './bash';
import { FetchTool } from './fetch';
import { SearchTool, createSearchTool } from './search';
import { CalculatorTool } from './calculate';
import { CurrentTimeTool } from './time';
import { SleepTool } from './sleep';
import { GrepTool } from './grep';
import { GlobTool } from './glob';
import { FindTool } from './find';
import { EditTool } from './edit';
import { diffpatchTool } from './diffpatch';
import { AskUserTool } from './ask_user';
import type { Tool } from '../../types';

/**
 * All built-in tools using the new Tool<P,M> interface.
 *
 * Each tool now provides:
 * - Zod parameter schema for type-safe validation
 * - Full ToolContext access (abort signal, metadata, ask)
 * - Structured ToolResult with metadata
 */
export const BuiltinTools: Tool[] = [
  ReadTool,
  WriteTool,
  LsTool,
  BashTool,
  FetchTool,
  SearchTool,
  CalculatorTool,
  CurrentTimeTool,
  SleepTool,
  GrepTool,
  GlobTool,
  FindTool,
  EditTool,
  diffpatchTool,
  AskUserTool,
];

export {
  ReadTool,
  WriteTool,
  LsTool,
  BashTool,
  BashToolExecutor,
  FetchTool,
  SearchTool,
  createSearchTool,
  CalculatorTool,
  CurrentTimeTool,
  SleepTool,
  GrepTool,
  GlobTool,
  FindTool,
  EditTool,
  diffpatchTool,
  AskUserTool,
};
