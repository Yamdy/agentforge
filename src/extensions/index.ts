/**
 * Extensions — subagent delegation, MCP client, skill system
 *
 * Aggregates the three extension subsystems into a single sub-path export.
 *
 * @module agentforge/extensions
 */

// ============================================================
// Subagent
// ============================================================

export { SubagentRegistry, createSubagentRegistry } from '../subagent/index.js';
export type {
  AgentLoop,
  SubagentConfig,
  SubagentRunOptions,
  SubagentResult,
  SubagentEntry,
  SubagentMode,
  SubagentAsyncResult,
  AsyncSubagentHandle,
} from '../subagent/index.js';

// ============================================================
// MCP (Model Context Protocol)
// ============================================================

export { AgentForgeMCPClient, createMCPClient } from '../mcp/index.js';
export type {
  MCPClientOptions,
  CreateMCPClientOptions,
  MCPEventType,
  MCPEvent,
} from '../mcp/index.js';

// MCP Tool Adapter
export {
  adaptMCPTool,
  adaptMCPTools,
  isMCPToolName,
  parseMCPToolName,
  createMCPToolName,
  jsonSchemaToZod,
} from '../mcp/index.js';

// ============================================================
// Skill
// ============================================================

export { SkillRegistry, loadSkill, discoverSkills } from '../skill/index.js';
export type {
  SkillLoadResult,
  SkillInfo,
  SkillFrontmatter,
  SkillDiscoveryOptions,
} from '../skill/index.js';
