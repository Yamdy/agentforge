import dotenv from 'dotenv';
import { Agent, InMemoryHistory, ToolRegistry, AIAdapter, MCP } from '../index.js';

dotenv.config();

async function main() {
  console.log('=== Primo Agent MCP 示例 ===\n');

  // 1. 初始化 MCP
  console.log('1. 初始化 MCP 客户端...');
  await MCP.client.init();
  console.log('   ✓ MCP 初始化完成\n');

  // 2. 显示 MCP 服务器状态
  console.log('2. MCP 服务器状态:');
  const status = MCP.client.status();
  for (const [name, s] of Object.entries(status)) {
    console.log(`   - ${name}: ${s.status}`);
  }
  console.log('');

  // 3. 获取 MCP 工具
  console.log('3. 获取 MCP 工具...');
  const mcpTools = await MCP.client.tools();
  const toolCount = Object.keys(mcpTools).length;
  console.log(`   ✓ 发现 ${toolCount} 个 MCP 工具\n`);

  // 4. 刷新 Toolkit
  console.log('4. 刷新工具分组...');
  await MCP.Toolkit.refreshTools();
  const basicTools = MCP.Toolkit.getTools(['basic']);
  console.log(`   ✓ Basic 组有 ${basicTools.length} 个工具\n`);

  // 5. 如果有 API key，创建 Agent 并运行
  const apiKey = process.env.DOUBAO_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log('5. 创建 Agent...');

    const adapter = new AIAdapter({
      model: process.env.MODEL || 'doubao-seed-2.0-code',
      apiKey,
      baseURL: process.env.DOUBAO_BASE_URL || '',
    });

    const registry = new ToolRegistry();

    // 注册 MCP 工具
    for (const tool of basicTools) {
      registry.register(tool);
    }

    adapter.setTools(registry.list());

    const history = new InMemoryHistory();
    const agent = new Agent(adapter, history, registry, { maxSteps: 10 });

    console.log('   ✓ Agent 创建完成\n');
    console.log('=== 准备就绪！您现在可以使用 Agent 了 ===\n');
  } else {
    console.log('5. 跳过 Agent 创建（未设置 API key）\n');
    console.log('设置 DOUBAO_API_KEY 或 OPENAI_API_KEY 以运行 Agent');
  }
}

main().catch(console.error);
