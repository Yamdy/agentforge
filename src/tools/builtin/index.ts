import { ReadTool } from './read';
import { WriteTool } from './write';
import { LsTool } from './ls';
import { BashTool } from './bash';
import { FetchTool } from './fetch';
import { SearchTool, createSearchTool } from './search';
import { CalculatorTool } from './calculate';
import { CurrentTimeTool } from './time';
import { SleepTool } from './sleep';

export const BuiltinTools = [
  ReadTool,
  WriteTool,
  LsTool,
  BashTool,
  FetchTool,
  SearchTool,
  CalculatorTool,
  CurrentTimeTool,
  SleepTool,
];

export {
  ReadTool,
  WriteTool,
  LsTool,
  BashTool,
  FetchTool,
  SearchTool,
  createSearchTool,
  CalculatorTool,
  CurrentTimeTool,
  SleepTool,
};
