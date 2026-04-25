/**
 * AgentForge MCP (Model Context Protocol) 客户端示例
 *
 * 本示例展示：
 * 1. Stdio 传输层连接 MCP 服务器（使用 Puppeteer MCP Server）
 * 2. HTTP 传输层连接 MCP 服务器
 * 3. 工具发现与执行
 * 4. MCP 工具集成到 ToolRegistry
 * 5. 连接错误处理
 *
 * MCP 协议基于 JSON-RPC 2.0，支持 Stdio 和 HTTP 两种传输方式。
 *
 * 运行方式：
 * - Puppeteer 示例：npx tsx examples/08-mcp-client.ts puppeteer
 * - Stdio 示例：npx tsx examples/08-mcp-client.ts stdio
 * - HTTP 示例：npx tsx examples/08-mcp-client.ts http
 * - 工具集成示例：npx tsx examples/08-mcp-client.ts integration
 *
 * 推荐使用 Puppeteer MCP Server 进行浏览器自动化测试：
 *   配置: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] }
 */

import {
  // 客户端
  createMCPClient,
  type MCPEvent,
  // 传输层
  StdioTransport,
  StreamableHTTPTransport,
  // 工具适配
  adaptMCPTools,
  isMCPToolName,
  parseMCPToolName,
  createMCPToolName,
  // 类型
  type JSONRPCMessage,
  type JSONRPCRequest,
} from '../src/mcp/index.js';
import { SimpleToolRegistry } from '../src/core/index.js';
import type { MCPServerConfig } from '../src/core/interfaces.js';

// ============================================================
// 示例 1: Puppeteer MCP Server (真实示例)
// ============================================================

/**
 * Puppeteer MCP Server 示例
 *
 * 使用 @modelcontextprotocol/server-puppeteer 进行浏览器自动化。
 * 这是一个真实的 MCP 服务器，提供浏览器操作能力。
 *
 * 可用工具:
 * - puppeteer_navigate: 导航到 URL
 * - puppeteer_screenshot: 截取屏幕截图
 * - puppeteer_click: 点击元素
 * - puppeteer_fill: 填充输入框
 * - puppeteer_select: 选择下拉框
 * - puppeteer_hover: 悬停元素
 * - puppeteer_evaluate: 执行 JavaScript
 */
async function exampleEverythingMCP(): Promise<void> {
  console.log('=== 示例 1: Everything MCP Server (推荐测试) ===\n');

  // Everything MCP Server 配置（来自用户配置）
  const config: MCPServerConfig = {
    name: 'everything',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  };

  // 收集事件
  const events: MCPEvent[] = [];

  // 创建 MCP 客户端
  const client = createMCPClient(config, {
    serverName: 'everything',
    sessionId: 'everything-demo-' + Date.now(),
    timeout: 60000,
    emitEvent: (event: MCPEvent) => {
      events.push(event);
      console.log(`[MCP 事件] ${event.type}`);
    },
  });

  try {
    // 连接到 MCP 服务器
    console.log('正在连接 Everything MCP 服务器...');
    console.log('命令: npx -y @modelcontextprotocol/server-everything\n');
    await client.connect();
    console.log('连接成功！\n');

    // 获取可用工具列表
    console.log('获取 Everything MCP 工具列表:');
    const tools = await client.tools();
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description?.slice(0, 50) ?? '无描述'}...`);
    }
    console.log(`\n共发现 ${tools.length} 个示例工具\n`);

    // 获取可用资源列表
    console.log('获取资源列表:');
    try {
      const resources = await client.resources?.() ?? [];
      for (const resource of resources) {
        console.log(`  - ${resource.uri}: ${resource.name}`);
      }
      console.log(`\n共发现 ${resources.length} 个资源\n`);
    } catch {
      console.log('  (此服务器不支持资源列表)\n');
    }

    // 尝试调用一个简单工具
    const echoTool = tools.find((t) => t.name.includes('echo') || t.name.includes('sample'));
    if (echoTool !== undefined) {
      console.log(`执行工具 "${echoTool.name}":`);
      try {
        const result = await client.callTool(echoTool.name, { message: 'Hello from AgentForge!' });
        console.log(`  结果: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}\n`);
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        console.log(`  工具调用失败: ${message}\n`);
      }
    }

    // 显示收集的事件
    console.log('收集的 MCP 事件:');
    for (const event of events) {
      console.log(`  - ${event.type}`);
    }
    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Everything MCP 连接失败: ${message}`);
    console.log('提示：请确保已安装 Node.js 并可访问 npx\n');
  } finally {
    // 断开连接
    console.log('断开 Everything MCP 连接...');
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 示例 2: Puppeteer MCP Server
// ============================================================

/**
 * Puppeteer MCP Server 示例
 *
 * 使用 @modelcontextprotocol/server-puppeteer 进行浏览器自动化。
 * 这是一个真实的 MCP 服务器，提供浏览器操作能力。
 */
async function examplePuppeteerMCP(): Promise<void> {
  console.log('=== 示例 2: Puppeteer MCP Server ===\n');

  const config: MCPServerConfig = {
    name: 'puppeteer',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  };

  const events: MCPEvent[] = [];

  const client = createMCPClient(config, {
    serverName: 'puppeteer',
    sessionId: 'puppeteer-demo-' + Date.now(),
    timeout: 60000,
    emitEvent: (event: MCPEvent) => {
      events.push(event);
      console.log(`[MCP 事件] ${event.type}`);
    },
  });

  try {
    console.log('正在连接 Puppeteer MCP 服务器...');
    console.log('命令: npx -y @modelcontextprotocol/server-puppeteer\n');
    await client.connect();
    console.log('连接成功！\n');

    const tools = await client.tools();
    console.log('获取 Puppeteer 工具列表:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description?.slice(0, 50) ?? '无描述'}...`);
    }
    console.log(`\n共发现 ${tools.length} 个浏览器自动化工具\n`);

    // 尝试导航
    const navigateTool = tools.find((t) => t.name === 'puppeteer_navigate');
    if (navigateTool !== undefined) {
      console.log('执行 puppeteer_navigate:');
      try {
        await client.callTool('puppeteer_navigate', { url: 'https://example.com' });
        console.log('  导航成功！\n');
      } catch (navError) {
        const message = navError instanceof Error ? navError.message : String(navError);
        console.log(`  导航失败: ${message}\n`);
      }
    }

    console.log('收集的 MCP 事件:');
    for (const event of events) {
      console.log(`  - ${event.type}`);
    }
    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Puppeteer MCP 连接失败: ${message}`);
    console.log('提示：首次运行需要下载 puppeteer，可能需要几分钟\n');
  } finally {
    console.log('断开 Puppeteer MCP 连接...');
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 示例 3: Stdio 传输层连接 (Filesystem)
// ============================================================

/**
 * Stdio 传输层示例（Filesystem MCP Server）
 */
async function exampleStdioTransport(): Promise<void> {
  console.log('=== 示例 3: Stdio 传输层连接 (Filesystem) ===\n');

  const config: MCPServerConfig = {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  };

  // 创建 MCP 客户端
  const client = createMCPClient(config, {
    serverName: 'filesystem',
    sessionId: 'demo-session-001',
    timeout: 30000,
    emitEvent: (event: MCPEvent) => {
      console.log(`[MCP 事件] ${event.type}`);
    },
  });

  try {
    // 连接到 MCP 服务器
    console.log('正在连接 MCP 服务器...');
    await client.connect();
    console.log('连接成功！\n');

    // 获取可用工具列表
    console.log('获取可用工具:');
    const tools = await client.tools();
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }
    console.log('\n');

    // 调用工具（如果服务器支持）
    if (tools.length > 0) {
      const firstTool = tools[0];
      if (firstTool !== undefined) {
        console.log(`调用工具 "${firstTool.name}":`);
        try {
          // 根据工具类型传递不同的参数
          const result = await client.callTool(firstTool.name, {
            path: '/tmp',
          });
          console.log(`  结果: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : String(toolError);
          console.log(`  工具调用失败: ${message}`);
        }
      }
    }
    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`连接失败: ${message}`);
    console.log('提示：请确保已安装 Node.js 并可访问 npx\n');
  } finally {
    // 断开连接
    console.log('断开连接...');
    await client.disconnect();
    console.log('已断开\n');
  }
}

// ============================================================
// 示例 2: HTTP 传输层连接
// ============================================================

/**
 * HTTP 传输层示例
 *
 * HTTP 传输基于 HTTP POST + SSE (Server-Sent Events)。
 * 适用于远程 MCP 服务器。
 *
 * 协议流程：
 * 1. POST /mcp - 发送请求，可能返回 JSON 或 SSE 流
 * 2. GET /mcp - 建立 SSE 流用于服务器通知
 * 3. DELETE /mcp - 终止会话
 *
 * 会话管理：通过 mcp-session-id 头部
 */
async function exampleHTTPTransport(): Promise<void> {
  console.log('=== 示例 4: HTTP 传输层连接 ===\n');

  // HTTP 服务器配置
  const config: MCPServerConfig = {
    name: 'http-server',
    type: 'http',
    url: 'http://localhost:3000/mcp',
  };

  // 创建 MCP 客户端
  const client = createMCPClient(config, {
    serverName: 'http-server',
    sessionId: 'demo-session-002',
    timeout: 30000,
  });

  try {
    console.log('正在连接 HTTP MCP 服务器...');
    console.log(`URL: ${config.url}\n`);

    await client.connect();
    console.log('连接成功！\n');

    // 获取工具列表
    const tools = await client.tools();
    console.log(`发现 ${tools.length} 个工具:\n`);

    for (const tool of tools) {
      console.log(`  - ${tool.name}`);
      console.log(`    描述: ${tool.description}`);
      console.log(`    参数 Schema: ${JSON.stringify(tool.inputSchema).slice(0, 100)}...`);
    }
    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`HTTP 连接失败: ${message}`);
    console.log('提示：请确保 MCP HTTP 服务器正在运行\n');
  } finally {
    await client.disconnect();
    console.log('已断开 HTTP 连接\n');
  }
}

// ============================================================
// 示例 3: 直接使用传输层
// ============================================================

/**
 * 直接使用传输层示例
 *
 * 展示如何直接使用 StdioTransport 和 StreamableHTTPTransport，
 * 而不通过 MCP 客户端封装。
 */
async function exampleDirectTransport(): Promise<void> {
  console.log('=== 示例 5: 直接使用传输层 ===\n');

  // StdioTransport 直接使用
  console.log('StdioTransport 直接使用:');
  const stdioTransport = new StdioTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  });

  // 设置消息处理器
  stdioTransport.onmessage = (message: JSONRPCMessage) => {
    console.log(`  收到消息: ${JSON.stringify(message).slice(0, 100)}...`);
  };

  stdioTransport.onerror = (error: Error) => {
    console.log(`  传输错误: ${error.message}`);
  };

  stdioTransport.onclose = () => {
    console.log('  传输连接已关闭');
  };

  try {
    await stdioTransport.connect();
    console.log('  StdioTransport 已连接');

    // 手动发送 JSON-RPC 请求
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    };
    await stdioTransport.send(request);
    console.log('  已发送 tools/list 请求\n');

    // 等待响应（实际应用中需要处理响应）
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  连接失败: ${message}\n`);
  } finally {
    await stdioTransport.close();
    console.log('  StdioTransport 已关闭\n');
  }

  // HTTPTransport 直接使用
  console.log('HTTPTransport 直接使用:');
  const httpTransport = new StreamableHTTPTransport({
    url: new URL('http://localhost:3000/mcp'),
  });

  httpTransport.onmessage = (message: JSONRPCMessage) => {
    console.log(`  HTTP 收到消息: ${JSON.stringify(message).slice(0, 100)}...`);
  };

  console.log('  HTTPTransport 配置完成（跳过连接演示）\n');
}

// ============================================================
// 示例 4: 工具发现与执行
// ============================================================

/**
 * 工具发现与执行示例
 *
 * 展示如何：
 * 1. 从 MCP 服务器获取工具列表
 * 2. 调用 MCP 工具
 * 3. 处理工具返回结果
 */
async function exampleToolDiscovery(): Promise<void> {
  console.log('=== 示例 6: 工具发现与执行 ===\n');

  const config: MCPServerConfig = {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  };

  const client = createMCPClient(config, {
    serverName: 'filesystem',
    sessionId: 'tool-discovery-demo',
  });

  try {
    await client.connect();

    // 获取工具列表
    const tools = await client.tools();
    console.log(`发现 ${tools.length} 个工具\n`);

    // 展示工具详情
    for (const tool of tools) {
      console.log(`工具: ${tool.name}`);
      console.log(`  描述: ${tool.description}`);

      // 解析 inputSchema
      const schema = tool.inputSchema;
      const properties = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
      const required = schema.required as string[] | undefined;

      if (properties !== undefined) {
        console.log('  参数:');
        for (const [key, prop] of Object.entries(properties)) {
          const isRequired = required?.includes(key) ?? false;
          console.log(`    - ${key}: ${prop.type ?? 'unknown'} ${isRequired ? '(必需)' : '(可选)'}`);
          if (prop.description !== undefined) {
            console.log(`      ${prop.description}`);
          }
        }
      }
      console.log('\n');
    }

    // 执行工具调用示例
    const listTools = tools.filter((t) => t.name.includes('list') || t.name.includes('read'));

    if (listTools.length > 0) {
      const tool = listTools[0];
      if (tool !== undefined) {
        console.log(`执行工具 "${tool.name}":`);

        // 根据工具名构造参数
        const args: Record<string, unknown> = {};
        const schema = tool.inputSchema;
        const properties = schema.properties as Record<string, unknown> | undefined;

        if (properties !== undefined && 'path' in properties) {
          args.path = '/tmp';
        }

        const result = await client.callTool(tool.name, args);
        console.log(`  结果: ${result.slice(0, 300)}${result.length > 300 ? '...' : ''}\n`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`工具发现失败: ${message}\n`);
  } finally {
    await client.disconnect();
  }
}

// ============================================================
// 示例 5: 集成到 ToolRegistry
// ============================================================

/**
 * MCP 工具集成到 ToolRegistry 示例
 *
 * 展示如何使用 adaptMCPTools 将 MCP 工具转换为
 * AgentForge 的 ToolDefinition，并注册到 SimpleToolRegistry。
 */
async function exampleToolRegistryIntegration(): Promise<void> {
  console.log('=== 示例 7: 集成到 ToolRegistry ===\n');

  const config: MCPServerConfig = {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  };

  const client = createMCPClient(config, {
    serverName: 'filesystem',
    sessionId: 'registry-integration-demo',
  });

  const toolRegistry = new SimpleToolRegistry();

  try {
    await client.connect();

    // 获取 MCP 工具并适配
    const mcpTools = await client.tools();
    console.log(`发现 ${mcpTools.length} 个 MCP 工具\n`);

    // 使用 adaptMCPTools 批量转换
    const toolDefinitions = adaptMCPTools(mcpTools, client, 'filesystem');

    // 注册到 ToolRegistry
    toolRegistry.registerAll(toolDefinitions);
    console.log('已注册的 MCP 工具:');
    for (const name of toolRegistry.list()) {
      console.log(`  - ${name}`);
    }
    console.log('\n');

    // 展示工具名称解析
    console.log('工具名称解析:');
    for (const name of toolRegistry.list().slice(0, 3)) {
      const parsed = parseMCPToolName(name);
      if (parsed !== null) {
        console.log(`  ${name}`);
        console.log(`    -> 服务器: "${parsed.serverName}", 工具: "${parsed.originalToolName}"`);
      }
    }
    console.log('\n');

    // 检查是否为 MCP 工具
    console.log('MCP 工具检测:');
    console.log(`  isMCPToolName("mcp_filesystem_read_file"): ${isMCPToolName('mcp_filesystem_read_file')}`);
    console.log(`  isMCPToolName("local_tool"): ${isMCPToolName('local_tool')}`);
    console.log('\n');

    // 通过 ToolRegistry 执行 MCP 工具
    const mcpToolNames = toolRegistry.list().filter(isMCPToolName);
    if (mcpToolNames.length > 0) {
      const firstToolName = mcpToolNames[0];
      if (firstToolName !== undefined) {
        console.log(`通过 ToolRegistry 执行 "${firstToolName}":`);

        const tool = toolRegistry.get(firstToolName);
        if (tool !== undefined) {
          // 构造参数
          const args: Record<string, unknown> = {};
          // 根据工具参数 schema 构造参数
          const result = await tool.execute(args);
          console.log(`  结果: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}\n`);
        }
      }
    }

    // 创建工具名称
    console.log('创建 MCP 工具名称:');
    const toolName = createMCPToolName('myserver', 'my_tool');
    console.log(`  createMCPToolName('myserver', 'my_tool') = "${toolName}"`);
    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`集成失败: ${message}\n`);
  } finally {
    await client.disconnect();
  }
}

// ============================================================
// 示例 6: 错误处理
// ============================================================

/**
 * 错误处理示例
 *
 * 展示各种错误场景的处理方式：
 * 1. 连接失败
 * 2. 工具不存在
 * 3. 参数验证失败
 * 4. 传输层错误
 */
async function exampleErrorHandling(): Promise<void> {
  console.log('=== 示例 8: 错误处理 ===\n');

  // 场景 1: 连接失败（无效命令）
  console.log('场景 1: 连接失败 - 无效命令');
  const invalidConfig: MCPServerConfig = {
    name: 'invalid',
    type: 'stdio',
    command: 'nonexistent-command-12345',
  };

  const client1 = createMCPClient(invalidConfig, {
    serverName: 'invalid',
    sessionId: 'error-demo-1',
  });

  try {
    await client1.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  捕获错误: ${message.slice(0, 100)}...\n`);
  }

  // 场景 2: 连接失败（无效 URL）
  console.log('场景 2: 连接失败 - 无效 URL');
  const invalidHttpConfig: MCPServerConfig = {
    name: 'invalid-http',
    type: 'http',
    url: 'http://localhost:99999/invalid',
  };

  const client2 = createMCPClient(invalidHttpConfig, {
    serverName: 'invalid-http',
    sessionId: 'error-demo-2',
  });

  try {
    await client2.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  捕获错误: ${message.slice(0, 100)}...\n`);
  }

  // 场景 3: 在未连接状态下调用工具
  console.log('场景 3: 未连接状态调用工具');
  const client3 = createMCPClient(
    { name: 'test', type: 'stdio', command: 'echo' },
    { serverName: 'test', sessionId: 'error-demo-3' }
  );

  try {
    await client3.callTool('some_tool', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  捕获错误: ${message}\n`);
  }

  // 场景 4: 事件监听错误
  console.log('场景 4: 通过事件监听错误');
  const errorEvents: MCPEvent[] = [];

  const client4 = createMCPClient(
    { name: 'error-listener', type: 'stdio', command: 'invalid-command' },
    {
      serverName: 'error-listener',
      sessionId: 'error-demo-4',
      emitEvent: (event) => {
        errorEvents.push(event);
      },
    }
  );

  try {
    await client4.connect();
  } catch {
    // 忽略
  }

  const errorEvent = errorEvents.find((e) => e.type === 'mcp.error');
  if (errorEvent !== undefined) {
    console.log(`  事件类型: ${errorEvent.type}`);
    console.log(`  服务器: ${errorEvent.serverName}`);
    console.log(`  错误: ${JSON.stringify(errorEvent.error).slice(0, 100)}...\n`);
  }

  // 场景 5: 重复连接
  console.log('场景 5: 重复连接');
  const client5 = createMCPClient(
    { name: 'test', type: 'stdio', command: 'echo' },
    { serverName: 'test', sessionId: 'error-demo-5' }
  );

  try {
    await client5.connect();
    await client5.connect(); // 第二次连接应该失败
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  捕获错误: ${message}\n`);
  } finally {
    await client5.disconnect();
  }

  console.log('错误处理示例完成\n');
}

// ============================================================
// 示例 7: 完整工作流
// ============================================================

/**
 * 完整工作流示例
 *
 * 展示一个完整的 MCP 客户端使用流程：
 * 1. 创建客户端
 * 2. 连接服务器
 * 3. 发现工具
 * 4. 执行工具
 * 5. 监听事件
 * 6. 断开连接
 */
async function exampleCompleteWorkflow(): Promise<void> {
  console.log('=== 示例 9: 完整工作流 ===\n');

  // 收集所有事件
  const events: MCPEvent[] = [];

  // 配置
  const config: MCPServerConfig = {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  };

  // 创建客户端（带事件监听）
  const client = createMCPClient(config, {
    serverName: 'filesystem',
    sessionId: 'complete-workflow-demo',
    timeout: 30000,
    emitEvent: (event) => {
      events.push(event);
    },
  });

  console.log('步骤 1: 连接服务器');
  try {
    await client.connect();
    console.log('  连接成功\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  连接失败: ${message}\n`);
    return;
  }

  console.log('步骤 2: 发现工具');
  const tools = await client.tools();
  console.log(`  发现 ${tools.length} 个工具\n`);

  console.log('步骤 3: 执行工具');
  if (tools.length > 0) {
    const tool = tools[0];
    if (tool !== undefined) {
      try {
        // 构造参数
        const args: Record<string, unknown> = {};
        const schema = tool.inputSchema;
        const properties = schema.properties as Record<string, unknown> | undefined;
        if (properties !== undefined && 'path' in properties) {
          args.path = '/tmp';
        }

        const result = await client.callTool(tool.name, args);
        console.log(`  工具: ${tool.name}`);
        console.log(`  结果长度: ${result.length} 字符\n`);
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : String(toolError);
        console.log(`  执行失败: ${message}\n`);
      }
    }
  }

  console.log('步骤 4: 查看事件');
  console.log('  收集的事件:');
  for (const event of events) {
    console.log(`    - ${event.type}`);
  }
  console.log('\n');

  console.log('步骤 5: 断开连接');
  await client.disconnect();
  console.log('  已断开\n');

  console.log('最终事件列表:');
  for (const event of events) {
    console.log(`  ${event.type} @ ${new Date(event.timestamp).toISOString()}`);
  }
  console.log('\n');
}

// ============================================================
// Mock MCP 服务器说明
// ============================================================

/**
 * Mock MCP 服务器说明
 *
 * 此示例需要实际的 MCP 服务器才能运行。
 *
 * 常用的 MCP 服务器：
 * 1. @modelcontextprotocol/server-filesystem - 文件系统操作
 *    npx -y @modelcontextprotocol/server-filesystem /path/to/allow
 *
 * 2. @modelcontextprotocol/server-github - GitHub API
 *    npx -y @modelcontextprotocol/server-github
 *
 * 3. @modelcontextprotocol/server-postgres - PostgreSQL 数据库
 *    npx -y @modelcontextprotocol/server-postgres "postgresql://..."
 *
 * 4. 自定义 HTTP MCP 服务器
 *    需要实现 JSON-RPC 2.0 + SSE 协议
 *
 * MCP 协议要点：
 * - 初始化握手：initialize -> initialized
 * - 工具发现：tools/list
 * - 工具调用：tools/call
 * - 错误处理：result.isError 字段
 */

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  const example = process.argv[2] ?? 'all';

  switch (example) {
    case 'everything':
      await exampleEverythingMCP();
      break;
    case 'puppeteer':
      await examplePuppeteerMCP();
      break;
    case 'stdio':
      await exampleStdioTransport();
      break;
    case 'http':
      await exampleHTTPTransport();
      break;
    case 'transport':
      await exampleDirectTransport();
      break;
    case 'discovery':
      await exampleToolDiscovery();
      break;
    case 'integration':
      await exampleToolRegistryIntegration();
      break;
    case 'error':
      await exampleErrorHandling();
      break;
    case 'workflow':
      await exampleCompleteWorkflow();
      break;
    case 'all':
    default:
      console.log('AgentForge MCP 客户端示例\n');
      console.log('用法: npx tsx examples/08-mcp-client.ts <示例名称>\n');
      console.log('可用示例:');
      console.log('  everything  - Everything MCP Server (推荐测试)');
      console.log('  puppeteer   - Puppeteer MCP Server (浏览器自动化)');
      console.log('  stdio       - Stdio 传输层连接 (Filesystem)');
      console.log('  http        - HTTP 传输层连接');
      console.log('  transport   - 直接使用传输层');
      console.log('  discovery   - 工具发现与执行');
      console.log('  integration - 集成到 ToolRegistry');
      console.log('  error       - 错误处理');
      console.log('  workflow    - 完整工作流');
      console.log('  all         - 运行所有示例（默认）\n');

      // 运行错误处理示例（不需要真实服务器）
      await exampleErrorHandling();
      break;
  }
}

// 运行主函数
main().catch(console.error);
