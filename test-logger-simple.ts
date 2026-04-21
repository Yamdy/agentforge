import { Log } from "./packages/core/src/log";

// 初始化日志系统
Log.init({
  print: true, // 打印到控制台
  level: "DEBUG",
  dev: true,
});

const logger = Log.create({ service: "demo" });

console.log("\n✅ 基础日志功能测试：");
logger.debug("调试信息", { foo: "bar", num: 123 });
logger.info("操作成功", { status: "ok", id: "abc123" });
logger.warn("警告信息", { usage: "90%", threshold: "85%" });
logger.error("错误信息", { error: "连接失败", code: 503 });

console.log("\n✅ 计时功能测试：");
const timer = logger.time("文件上传");
// 模拟耗时操作
setTimeout(() => {
  timer.stop();

  console.log("\n✅ 标签功能测试：");
  const userLogger = logger.tag("userId", "user_12345");
  userLogger.info("用户登录");
  userLogger.info("访问页面", { page: "/dashboard" });

  console.log("\n✅ 多服务日志测试：");
  const skillLogger = Log.create({ service: "skill-manager" });
  skillLogger.info("技能注册成功", { skillId: "calculator", name: "计算器" });
  skillLogger.info("技能执行完成", { skillId: "calculator", duration: 12, success: true });

  const sessionLogger = Log.create({ service: "session-manager" });
  sessionLogger.info("会话创建", { sessionId: "session_123", ip: "127.0.0.1" });
  sessionLogger.info("添加消息", { sessionId: "session_123", role: "user", length: 45 });

  console.log("\n🎉 日志系统所有功能测试通过！");
  console.log("\n日志格式说明：");
  console.log("[级别] [时间] [耗时] [标签键=标签值] [消息内容]");
}, 800);
