/**
 * AgentForge MCP (Model Context Protocol) 客户端示例
 *
 * 使用官方 @modelcontextprotocol/sdk 确保与所有 MCP 服务器兼容。
 *
 * 运行方式：
 * - Everything 示例：npx tsx examples/08-mcp-client.ts everything
 * - Puppeteer 示例：npx tsx examples/08-mcp-client.ts puppeteer
 * - Filesystem 示例：npx tsx examples/08-mcp-client.ts filesystem
 */

import { createMCPSDKClient, type MCPEvent } from '../src/mcp/sdk-client.js';
import type { MCPServerConfig } from '../src/core/interfaces.js';

// ============================================================
// 示例 1: Everything MCP Server (推荐测试)
// ============================================================

/**
 * Everything MCP Server 示例
 *
 * @modelcontextprotocol/server-everything 提供示例工具用于测试 MCP 集成。
 */
async function exampleEverythingMCP(): Promise<void> {
  console.log('=== 示例 1: Everything MCP Server ===\n');

  const config: MCPServerConfig = {
    name: 'everything',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  };

  const events: MCPEvent[] = [];

  const client = createMCPSDKClient(config, {
    serverName: 'everything',
    sessionId: 'everything-demo-' + Date.now(),
    timeout: 60000,
    emitEvent: (event: MCPEvent) => {
      events.push(event);
      console.log(`[MCP 事件] ${event.type}`);
    },
  });

  try {
    console.log('正在连接 Everything MCP 服务器...');
    console.log('命令: npx -y @modelcontextprotocol/server-everything\n');

    await client.connect();
    console.log('连接成功！\n');

    // 获取工具列表
    const tools = await client.tools();
    console.log('可用工具:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description?.slice(0, 60) ?? '无描述'}...`);
    }
    console.log(`\n共发现 ${tools.length} 个工具\n`);

    // 调用示例工具
    const echoTool = tools.find(t => t.name === 'echo');
    if (echoTool) {
      console.log('调用 echo 工具:');
      const result = await client.callTool('echo', { message: 'Hello from AgentForge!' });
      console.log(`  结果: ${result.slice(0, 200)}\n`);
    }

    // 获取资源列表
    const resources = await client.resources();
    if (resources.length > 0) {
      console.log('可用资源:');
      for (const res of resources) {
        console.log(`  - ${res.uri}: ${res.name}`);
      }
      console.log('\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`连接失败: ${message}`);
    console.log('提示：请确保已安装 Node.js 并可访问 npx\n');
  } finally {
    console.log('断开连接...');
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 示例 2: Puppeteer MCP Server
// ============================================================

async function examplePuppeteerMCP(): Promise<void> {
  console.log('=== 示例 2: Puppeteer MCP Server ===\n');

  const config: MCPServerConfig = {
    name: 'puppeteer',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  };

  const client = createMCPSDKClient(config, {
    serverName: 'puppeteer',
    sessionId: 'puppeteer-demo-' + Date.now(),
    timeout: 120000, // Puppeteer 需要更长时间
    emitEvent: event => console.log(`[MCP 事件] ${event.type}`),
  });

  try {
    console.log('正在连接 Puppeteer MCP 服务器...\n');
    await client.connect();
    console.log('连接成功！\n');

    const tools = await client.tools();
    console.log('Puppeteer 工具:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}`);
    }
    console.log('\n');

    // 尝试导航
    const navigateTool = tools.find(t => t.name === 'puppeteer_navigate');
    if (navigateTool) {
      console.log('执行 puppeteer_navigate:');
      try {
        await client.callTool('puppeteer_navigate', { url: 'https://example.com' });
        console.log('  导航成功！\n');
      } catch (navError) {
        const msg = navError instanceof Error ? navError.message : String(navError);
        console.log(`  导航失败: ${msg}\n`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`连接失败: ${message}`);
    console.log('提示：首次运行需要下载 Puppeteer，可能需要几分钟\n');
  } finally {
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 示例 3: Filesystem MCP Server
// ============================================================

async function exampleFilesystemMCP(): Promise<void> {
  console.log('=== 示例 3: Filesystem MCP Server ===\n');

  // Windows 使用当前目录
  const cwd = process.cwd();

  const config: MCPServerConfig = {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', cwd],
  };

  const client = createMCPSDKClient(config, {
    serverName: 'filesystem',
    sessionId: 'filesystem-demo',
    timeout: 30000,
    emitEvent: event => console.log(`[MCP 事件] ${event.type}`),
  });

  try {
    console.log('正在连接 Filesystem MCP 服务器...');
    console.log(`允许访问目录: ${cwd}\n`);

    await client.connect();
    console.log('连接成功！\n');

    const tools = await client.tools();
    console.log('Filesystem 工具:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}`);
    }
    console.log('\n');

    // 列出目录
    const listDir = tools.find(t => t.name === 'list_directory');
    if (listDir) {
      console.log('执行 list_directory:');
      const result = await client.callTool('list_directory', { path: cwd });
      console.log(`  结果: ${result.slice(0, 500)}...\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`连接失败: ${message}\n`);
  } finally {
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  const example = process.argv[2] ?? 'everything';

  switch (example) {
    case 'everything':
      await exampleEverythingMCP();
      break;
    case 'puppeteer':
      await examplePuppeteerMCP();
      break;
    case 'filesystem':
      await exampleFilesystemMCP();
      break;
    default:
      console.log('AgentForge MCP 客户端示例\n');
      console.log('用法: npx tsx examples/08-mcp-client.ts <示例名称>\n');
      console.log('可用示例:');
      console.log('  everything  - Everything MCP Server (推荐测试)');
      console.log('  puppeteer    - Puppeteer MCP Server (浏览器自动化)');
      console.log('  filesystem   - Filesystem MCP Server (文件操作)\n');
      break;
  }
}

main().catch(console.error);
