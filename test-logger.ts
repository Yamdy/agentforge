import { Log, InMemorySessionManager, Skill, SkillContext, SkillResult } from "./packages/core/src/index";
import { ChatAgent } from "./packages/agents/src/index";
import { MockLLMProvider } from "./packages/llm/src/index";

// 初始化日志系统
Log.init({
  print: true, // 打印到控制台，设为false会输出到.log文件
  level: "DEBUG", // 输出所有级别日志
  dev: true,
});

const logger = Log.create({ service: "test-demo" });

console.log("\n=== 测试基础日志功能 ===");
logger.debug("这是DEBUG日志", { userId: "123", action: "test" });
logger.info("这是INFO日志", { module: "logger", status: "success" });
logger.warn("这是WARN日志", { warning: "内存占用过高", usage: "85%" });
logger.error("这是ERROR日志", { error: "网络请求失败", code: 500 });

console.log("\n=== 测试日志计时功能 ===");
const timer = logger.time("耗时操作测试");
// 模拟耗时操作
setTimeout(() => {
  timer.stop();

  console.log("\n=== 测试标签功能 ===");
  const taggedLogger = logger.tag("module", "skill-test");
  taggedLogger.info("带标签的日志");

  console.log("\n=== 测试ChatAgent完整流程日志 ===");
  // 测试Skill
  class CalculatorSkill extends Skill {
    meta = {
      id: "calculator",
      name: "计算器",
      description: "进行数学计算",
      category: "工具",
      tags: ["math", "calculation"],
    };

    parameters = [
      {
        name: "a",
        description: "第一个数字",
        schema: { type: "number" },
        required: true,
      },
      {
        name: "b",
        description: "第二个数字",
        schema: { type: "number" },
        required: true,
      },
      {
        name: "operator",
        description: "操作符",
        schema: { type: "string", enum: ["+", "-", "*", "/"] },
        required: true,
      },
    ];

    async run(ctx: SkillContext, params: any): Promise<SkillResult> {
      const { a, b, operator } = params;
      let result: number;
      switch (operator) {
        case "+": result = a + b; break;
        case "-": result = a - b; break;
        case "*": result = a * b; break;
        case "/": result = a / b; break;
        default: return { success: false, error: "不支持的操作符" };
      }
      return { success: true, data: { result } };
    }
  }

  // 创建Agent
  const sessionManager = new InMemorySessionManager();
  const llmProvider = new MockLLMProvider();
  const agent = new ChatAgent({
    sessionManager,
    llmProvider,
    skills: [new CalculatorSkill()],
  });

  // 发送消息
  agent.sendMessage("你好，请计算 2 + 3 等于多少？").then((response) => {
    console.log("\nAgent回复:", response);
    console.log("\n=== 日志系统测试完成 ===");
  }).catch((err) => {
    console.error("测试失败:", err);
  });
}, 1200);
