# 工具调用示例使用指南

## 前置要求

1. **LLM模型需要支持工具调用（Function Calling）功能**
   - ✅ 支持的模型：OpenAI GPT-3.5/4、DeepSeek V2/V3、通义千问、智谱清言、豆包、Claude等
   - ❌ 不支持的模型：不具备函数调用能力的模型无法使用本功能

2. 已经在根目录配置好 `config.json` 文件

## 配置示例 (config.json)

```json
{
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "你的API KEY",
  "model": "deepseek-chat",
  "temperature": 0.1
}
```

### 不同服务商配置参考：

#### 1. DeepSeek
```json
{
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "sk-xxxxxx",
  "model": "deepseek-chat"
}
```

#### 2. OpenAI
```json
{
  "baseURL": "https://api.openai.com/v1",
  "apiKey": "sk-xxxxxx",
  "model": "gpt-3.5-turbo"
}
```

#### 3. 通义千问
```json
{
  "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "sk-xxxxxx",
  "model": "qwen-plus"
}
```

#### 4. 智谱清言
```json
{
  "baseURL": "https://open.bigmodel.cn/api/paas/v4",
  "apiKey": "your-api-key",
  "model": "glm-4"
}
```

## 运行示例

```bash
# 先复制配置文件到示例目录
cp ../config.json ./config.json

# 运行非流式/流式工具调用示例
pnpm tsx tool-call-demo.ts

# 运行Mock示例（不需要API，直接演示流程）
pnpm tsx mock-tool-call-demo.ts
```

## 示例包含的功能
1. ✅ 非流式工具调用（天气查询）
2. ✅ 非流式工具调用（数学计算）
3. ✅ 流式工具调用（边输出边调用工具）
4. ✅ 多轮会话历史查看
5. ✅ 工具调用全流程日志输出

## 常见问题

### Q: 运行报错提示模型不支持工具调用？
A: 请确认你使用的模型确实支持Function Calling功能，部分模型（比如一些开源小模型）没有这个能力。

### Q: 工具调用总是参数错误？
A: 可以尝试调低temperature参数，或者在system prompt中更明确地强调参数格式要求。

### Q: 工具总是被重复调用？
A: 可以调整maxToolCallRounds参数限制最大调用轮次，默认是3轮。
