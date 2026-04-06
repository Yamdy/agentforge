# 铁律

**不要着急实现，先分析必要性**

**有库相关问题优先查看库文档**

**typescript 绝对不要用 any 类型**

**修改代码后一定要测试验证**

**架构变化较大要更新文档（/docs）**

**特性优先参考opencode（D:\code\opencode）实现**

---

## MDX 文档生成规则

每次生成新代码时，遵循以下流程：

### 生成条件
- 代码行数 > 20 行
- 有公开 exports
- 排除：测试文件、配置文件、.d.ts、examples

### 流程
1. 检查是否需要生成配套 MDX
2. ，先生成 MDX 框架（使用 `prompts/templates/mdx-template.mdx`）
3. 再生成代码
4. 最后更新 MDX 中的示例和说明

### 存放路径
- 规则文件：`.agent-rules.json`
- 模板：`prompts/templates/mdx-template.mdx`
- 自动生成：`prompts/auto-generated/*.mdx`
- 公共组件：`prompts/common/components.mdx`

### 必须字段
- frontmatter: title, type, author, date, version, sourceFile, complexity, tests, dependencies
- content: Description, Signature, Parameters, Returns, Examples (≥2), Dependencies, Related