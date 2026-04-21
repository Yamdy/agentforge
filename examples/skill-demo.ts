import { Effect } from "effect";
import { z } from "zod";
import { ChatAgent } from "@agentforge/agents";
import { Skill, SkillContext, ISkill, Log } from "@agentforge/core";
import { OpenAICompatibleProvider } from "@agentforge/llm";
import { InMemorySessionManager } from "@agentforge/memory";

// 计算器Skill
const calculatorSkill: ISkill = new Skill({
  meta: {
    id: "calculator",
    name: "计算器",
    description: "执行数学计算，支持加减乘除幂运算",
    category: "工具",
    version: "1.0.0",
    tags: ["math", "calculation"],
  },
  parameters: [
    {
      name: "a",
      description: "第一个数字",
      schema: z.coerce.number(),
      required: true,
    },
    {
      name: "b",
      description: "第二个数字",
      schema: z.coerce.number(),
      required: true,
    },
    {
      name: "operation",
      description: "操作类型：add(加)/sub(减)/mul(乘)/div(除)/pow(幂)",
      schema: z.enum(["add", "sub", "mul", "div", "pow"]),
      required: true,
    },
  ],
  preExecute: (ctx: SkillContext, params: any) => {
    console.log(`[计算器Skill] 开始执行，参数：`, params);
    if (params.operation === "div" && params.b === 0) {
      throw new Error("除数不能为0");
    }
    return params;
  },
  execute: (ctx: SkillContext, params: any) => {
    const { a, b, operation } = params;
    switch (operation) {
      case "add": return a + b;
      case "sub": return a - b;
      case "mul": return a * b;
      case "div": return a / b;
      case "pow": return Math.pow(a, b);
      default: throw new Error(`不支持的操作：${operation}`);
    }
  },
  postExecute: (ctx: SkillContext, params: any, result: any) => {
    console.log(`[计算器Skill] 执行完成，结果：`, result);
    return result;
  },
  onError: (ctx: SkillContext, params: any, error: Error) => {
    console.error(`[计算器Skill] 执行失败：`, error.message);
    return `计算失败：${error.message}`;
  }
});

// 获取当前时间Skill
const currentTimeSkill: ISkill = new Skill({
  meta: {
    id: "get_current_time",
    name: "获取当前时间",
    description: "获取指定时区的当前时间，支持自定义格式",
    category: "工具",
    version: "1.0.0",
    tags: ["time", "date"],
  },
  parameters: [
    {
      name: "timezone",
      description: "时区，默认Asia/Shanghai",
      schema: z.string().default("Asia/Shanghai"),
      required: false,
    },
    {
      name: "format",
      description: "时间格式，默认YYYY-MM-DD HH:mm:ss",
      schema: z.string().default("YYYY-MM-DD HH:mm:ss"),
      required: false,
    },
  ],
  execute: (ctx: SkillContext, params: any) => {
    const now = new Date();
    // 简单格式化，实际项目可以用dayjs
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    let formatted = params.format
      .replace('YYYY', year.toString())
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
    
    return formatted;
  }
});

async function main() {
  // 初始化LLM，使用你自己的API配置
  const llm = new OpenAICompatibleProvider({
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3", // 火山引擎
    apiKey: "28baa4bf-59c6-4583-aecd-cbae71bde493", // 你自己的API Key
    model: "glm-4.7", // 模型
    temperature: 0,
  });

  // 创建Agent，注册Skill
  const agent = ChatAgent.createSync({
    llmProvider: llm,
    sessionManager: new InMemorySessionManager(),
    skills: [calculatorSkill, currentTimeSkill],
    systemPrompt: "你是智能助手，必须严格遵守以下规则：\n1. 所有需要计算的问题必须调用calculator工具，绝对不能自己计算。\n2. 所有询问时间的问题必须调用get_current_time工具，绝对不能编造时间。\n3. 调用工具的时候必须严格按照参数要求传参，不能传错参数。\n4. 返回结果要自然，不要暴露你调用了工具的细节。",
  });

  console.log("🤖 Agent初始化完成，已注册的Skill：");
  agent.skills.forEach(s => console.log(`- ${s.meta.id}: ${s.meta.name} - ${s.meta.description}`));
  console.log("=".repeat(50));

  // 测试1：计算问题
  console.log("\n❓ 测试1：1234 * 5678等于多少？");
  const res1 = await Effect.runPromise(agent.sendMessage("1234 * 5678等于多少？"));
  console.log(`🤖 回答：${res1}`);

  // 测试2：时间问题
  console.log("\n❓ 测试2：现在北京时间是几点？");
  const res2 = await Effect.runPromise(agent.sendMessage("现在北京时间是几点？"));
  console.log(`🤖 回答：${res2}`);

  // 测试3：错误处理
  console.log("\n❓ 测试3：100除以0等于多少？");
  const res3 = await Effect.runPromise(agent.sendMessage("100除以0等于多少？"));
  console.log(`🤖 回答：${res3}`);

  // 测试4：指定时区和格式
  console.log("\n❓ 测试4：现在纽约时间是几点，格式只要小时:分钟就可以？");
  const res4 = await Effect.runPromise(agent.sendMessage("现在纽约时间是几点，格式只要小时:分钟就可以？"));
  console.log(`🤖 回答：${res4}`);

  console.log("\n✅ 所有测试完成！");
}

main().catch(console.error);
