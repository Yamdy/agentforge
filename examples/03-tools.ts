/**
 * AgentForge 工具集成示例
 *
 * 本示例展示：
 * 1. 如何使用 Zod 定义工具参数 Schema
 * 2. 如何创建和注册工具到 SimpleToolRegistry
 * 3. 如何处理工具调用和验证参数
 *
 * 运行方式：npx tsx examples/03-tools.ts
 */

import { z } from 'zod';
import {
  SimpleToolRegistry,
  type ToolDefinition,
  zodToJsonSchema,
  zodToFunctionDef,
} from '../src/core/index.js';

// ============================================================
// 1. 使用 Zod 定义工具参数 Schema
// ============================================================

/**
 * 天气查询工具参数 Schema
 *
 * 使用 Zod 定义严格的参数验证规则：
 * - city: 必需的城市名称，最小长度 1
 * - unit: 可选的温度单位，默认为 'celsius'
 */
const WeatherToolSchema = z.object({
  city: z.string().min(1).describe('城市名称，如 "北京" 或 "Shanghai"'),
  unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('温度单位'),
  days: z.number().int().min(1).max(7).optional().describe('预报天数（1-7天）'),
});

/**
 * 计算工具参数 Schema
 */
const CalculatorSchema = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('运算类型'),
  a: z.number().describe('第一个数值'),
  b: z.number().describe('第二个数值'),
});

/**
 * 搜索工具参数 Schema
 */
const SearchSchema = z.object({
  query: z.string().min(1).max(100).describe('搜索关键词'),
  limit: z.number().int().min(1).max(50).default(10).describe('返回结果数量'),
  filters: z
    .object({
      type: z.enum(['web', 'image', 'video']).optional(),
      dateRange: z.enum(['day', 'week', 'month', 'year']).optional(),
    })
    .optional()
    .describe('搜索过滤器'),
});

// ============================================================
// 2. 创建工具定义
// ============================================================

/**
 * 天气查询工具定义
 *
 * ToolDefinition 包含：
 * - name: 工具名称（LLM 调用时使用）
 * - description: 工具描述（帮助 LLM 理解何时使用）
 * - parameters: Zod Schema（用于参数验证和 JSON Schema 生成）
 * - execute: 执行函数（处理实际逻辑）
 */
const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '获取指定城市的天气信息，支持温度单位和预报天数设置',
  parameters: WeatherToolSchema,
  execute: async (args: unknown) => {
    // 验证参数
    const parsed = WeatherToolSchema.safeParse(args);
    if (!parsed.success) {
      return `参数验证失败: ${JSON.stringify(parsed.error.issues)}`;
    }

    const { city, unit, days } = parsed.data;

    // 模拟天气数据返回
    const temperature = unit === 'celsius' ? 25 : 77;
    const forecast = days ? `${days}天预报` : '当前天气';

    return JSON.stringify({
      city,
      forecast,
      temperature,
      unit,
      condition: '晴朗',
      humidity: 60,
    });
  },
};

/**
 * 计算工具定义
 */
const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description: '执行基础数学运算：加减乘除',
  parameters: CalculatorSchema,
  execute: async (args: unknown) => {
    const parsed = CalculatorSchema.safeParse(args);
    if (!parsed.success) {
      return `参数验证失败: ${JSON.stringify(parsed.error.issues)}`;
    }

    const { operation, a, b } = parsed.data;

    let result: number;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) {
          return '错误：除数不能为零';
        }
        result = a / b;
        break;
    }

    return JSON.stringify({ operation, a, b, result });
  },
};

/**
 * 搜索工具定义
 */
const searchTool: ToolDefinition = {
  name: 'search',
  description: '执行网络搜索，支持多种搜索类型和过滤条件',
  parameters: SearchSchema,
  execute: async (args: unknown) => {
    const parsed = SearchSchema.safeParse(args);
    if (!parsed.success) {
      return `参数验证失败: ${JSON.stringify(parsed.error.issues)}`;
    }

    const { query, limit, filters } = parsed.data;

    // 模拟搜索结果
    const results = Array.from({ length: limit }, (_, i) => ({
      id: i + 1,
      title: `${query} 相关结果 #${i + 1}`,
      url: `https://example.com/result/${i + 1}`,
      snippet: `这是关于 "${query}" 的搜索结果摘要...`,
    }));

    return JSON.stringify({
      query,
      total: limit,
      filters,
      results,
    });
  },
};

// ============================================================
// 3. 注册工具到 SimpleToolRegistry
// ============================================================

/**
 * 创建工具注册中心
 *
 * SimpleToolRegistry 是 ToolRegistry 的基础实现，
 * 提供：
 * - register(): 注册单个工具
 * - registerAll(): 批量注册工具
 * - list(): 列出所有工具名称
 * - has(): 检查工具是否存在
 * - get(): 获取工具定义
 * - execute(): 执行工具调用
 */
const toolRegistry = new SimpleToolRegistry();

// 单个工具注册
toolRegistry.register(weatherTool);
toolRegistry.register(calculatorTool);

// 批量注册
toolRegistry.registerAll([searchTool]);

// ============================================================
// 4. 演示工具调用处理
// ============================================================

async function demoToolUsage(): Promise<void> {
  console.log('=== AgentForge 工具集成示例 ===\n');

  // 列出已注册工具
  console.log('已注册工具:');
  const toolNames = toolRegistry.list();
  for (const name of toolNames) {
    const tool = toolRegistry.get(name);
    if (tool) {
      console.log(`  - ${name}: ${tool.description}`);
    }
  }
  console.log('\n');

  // 检查工具是否存在
  console.log('检查工具是否存在:');
  console.log(`  get_weather 存在: ${toolRegistry.has('get_weather')}`);
  console.log(`  unknown_tool 存在: ${toolRegistry.has('unknown_tool')}`);
  console.log('\n');

  // 执行天气工具
  console.log('执行天气工具:');
  const weatherResult = await toolRegistry.execute('get_weather', {
    city: '北京',
    unit: 'celsius',
    days: 3,
  });
  console.log(`  结果: ${weatherResult}\n`);

  // 执行计算工具 - 加法
  console.log('执行计算工具（加法）:');
  const addResult = await toolRegistry.execute('calculator', {
    operation: 'add',
    a: 10,
    b: 5,
  });
  console.log(`  结果: ${addResult}\n`);

  // 执行计算工具 - 除法（边界测试）
  console.log('执行计算工具（除法）:');
  const divideResult = await toolRegistry.execute('calculator', {
    operation: 'divide',
    a: 20,
    b: 4,
  });
  console.log(`  结果: ${divideResult}\n`);

  // 执行搜索工具（使用默认值）
  console.log('执行搜索工具（使用默认 limit）:');
  const searchResult = await toolRegistry.execute('search', {
    query: 'AgentForge 框架',
  });
  console.log(`  结果: ${searchResult}\n`);

  // 参数验证失败示例
  console.log('参数验证失败示例:');
  const invalidResult = await toolRegistry.execute('get_weather', {
    city: '', // 空城市名，违反 min(1)
    days: 10, // 超出 max(7) 限制
  });
  console.log(`  结果: ${invalidResult}\n`);

  // ============================================================
  // 5. 展示 Schema 转换
  // ============================================================

  console.log('=== Zod Schema 转 JSON Schema ===\n');

  // 将 Zod Schema 转换为 JSON Schema（用于 LLM function calling）
  const weatherJsonSchema = zodToJsonSchema(WeatherToolSchema);
  console.log('天气工具 JSON Schema:');
  console.log(JSON.stringify(weatherJsonSchema, null, 2));
  console.log('\n');

  // 直接转换为 LLM FunctionDefinition
  const weatherFuncDef = zodToFunctionDef(
    'get_weather',
    '获取指定城市的天气信息',
    WeatherToolSchema
  );
  console.log('天气工具 FunctionDefinition:');
  console.log(JSON.stringify(weatherFuncDef, null, 2));
  console.log('\n');

  // ============================================================
  // 6. 错误处理示例
  // ============================================================

  console.log('=== 错误处理示例 ===\n');

  // 工具不存在
  try {
    await toolRegistry.execute('nonexistent_tool', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  工具不存在错误: ${message}\n`);
  }

  // 除数为零
  console.log('除数为零处理:');
  const zeroDivideResult = await toolRegistry.execute('calculator', {
    operation: 'divide',
    a: 10,
    b: 0,
  });
  console.log(`  结果: ${zeroDivideResult}\n`);

  console.log('=== 示例完成 ===');
}

// 运行示例
demoToolUsage().catch(console.error);