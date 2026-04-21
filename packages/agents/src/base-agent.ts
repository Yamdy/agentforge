import { Effect } from "effect";
import {
  Session,
  Tool,
  Skill,
  Log,
  SkillManager,
} from "@agentforge/core";
import { LLMProvider } from "@agentforge/llm";
import { Middleware, MiddlewareEvents, createMiddlewarePipeline } from "@agentforge/middleware";
import { AgentState } from "./state";

const logger = Log.create({ service: "base-agent" });

export interface BaseAgentConfig {
  sessionManager: any;
  llm: LLMProvider;
  systemPrompt?: string;
  middleware?: Middleware[];
  tools?: Tool[];
  skills?: Skill[];
  skillManager?: SkillManager;
  maxToolCallRounds?: number;
}

export abstract class BaseAgent {
  protected session: Session;
  protected readonly sessionManager: any;
  public readonly llm: LLMProvider & Partial<LLMStreamProvider>;
  protected readonly middleware?: ReturnType<typeof createMiddlewarePipeline>;
  protected readonly tools: Map<string, Tool>;
  protected readonly skillManager: SkillManager;
  protected readonly maxToolCallRounds: number;
  protected readonly agentState: AgentState;
  protected readonly logger: ReturnType<typeof Log.create>;
  protected readonly defaultSystemPrompt?: string;

  protected constructor(config: BaseAgentConfig, session: Session) {
    this.sessionManager = config.sessionManager;
    this.llm = config.llm;
    this.session = session;
    this.defaultSystemPrompt = config.systemPrompt;
    this.logger = Log.create({ service: "agent", sessionId: session.id });
    this.agentState = new AgentState();

    // 处理middleware配置
    if (config.middleware) {
      this.middleware = createMiddlewarePipeline(...config.middleware);
    }

    // 初始化Skill管理器
    this.skillManager = config.skillManager ?? new SkillManager();
    if (config.skills) {
      this.skillManager.registerAll(config.skills);
    }

    // 初始化工具
    this.tools = new Map();
    if (config.tools) {
      config.tools.forEach(tool => {
        this.tools.set(tool.name, tool);
      });
    }

    // 把所有Skill转换为Tool加入工具列表
    this.skillManager.getAllSkills().forEach(skill => {
      const skillAsTool: any = {
        name: skill.meta.id,
        description: skill.meta.description,
        parameters: skill.parameters,
        execute: (params: any) => Effect.tryPromise(async () => {
          const skillCtx: any = {
            agentId: this.constructor.name,
            sessionId: this.session.id,
            variables: {},
            metadata: {},
          };
          const result = await skill.run(skillCtx, params);
          if (!result.success) {
            throw new Error(result.error || 'Skill execution failed');
          }
          return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        })
      };
      this.tools.set(skillAsTool.name, skillAsTool);
    });

    // 初始化最大工具调用轮次，默认5次防止无限循环
    this.maxToolCallRounds = config.maxToolCallRounds ?? 5;

    // 触发启动事件
    this.triggerMiddleware(MiddlewareEvents.AGENT_START, { sessionId: this.session.id });
    this.logger.info("Agent initialized", {
      sessionId: this.session.id,
      toolsCount: this.tools.size,
      skillsCount: this.skillManager.getAllSkills().length,
    });
  }

  /**
   * 异步创建Agent实例，支持异步SessionManager（持久化场景）
   */
  public static async create<T extends BaseAgent>(
    this: new (config: BaseAgentConfig, session: Session) => T,
    config: BaseAgentConfig
  ): Promise<T> {
    const session = await Effect.runPromise(config.sessionManager.create({
      systemPrompt: config.systemPrompt,
    }));
    return new this(config, session);
  }

  /**
   * 同步创建Agent实例，仅支持同步SessionManager（内存场景）
   */
  public static createSync<T extends BaseAgent>(
    this: new (config: BaseAgentConfig, session: Session) => T,
    config: BaseAgentConfig
  ): T {
    const session = Effect.runSync(config.sessionManager.create({
      systemPrompt: config.systemPrompt,
    }));
    return new this(config, session);
  }

  /**
   * 核心抽象方法：子类必须实现具体的对话逻辑
   */
  public abstract sendMessage(message: string): Effect.Effect<string, any, never>;

  /**
   * 流式对话方法，子类可以选择实现
   */
  public sendMessageStream?(message: string): AsyncGenerator<string, string, unknown>;

  // --- 公共工具/技能管理API ---
  public registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.logger.info("Tool registered", { toolName: tool.name });
  }

  public registerTools(tools: Tool[]): void {
    tools.forEach(tool => this.registerTool(tool));
  }

  public registerSkill(skill: Skill): void {
    this.skillManager.register(skill);
    // 自动转换为工具
    const skillAsTool: any = {
      name: skill.meta.id,
      description: skill.meta.description,
      parameters: skill.parameters,
      execute: (params: any) => Effect.tryPromise(async () => {
        const skillCtx: any = {
          agentId: this.constructor.name,
          sessionId: this.session.id,
          variables: {},
          metadata: {},
        };
        const result = await skill.run(skillCtx, params);
        if (!result.success) {
          throw new Error(result.error || 'Skill execution failed');
        }
        return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      })
    };
    this.tools.set(skillAsTool.name, skillAsTool);
    this.logger.info("Skill registered", { skillId: skill.meta.id, skillName: skill.meta.name });
  }

  public registerSkills(skills: Skill[]): void {
    skills.forEach(skill => this.registerSkill(skill));
  }

  // --- 系统提示词API ---
  public setSystemPrompt(prompt: string): void {
    this.session.systemPrompt = prompt;
    this.logger.debug("System prompt updated", { length: prompt.length });
  }

  public getSystemPrompt(): string | undefined {
    return this.session.systemPrompt;
  }

  public resetSystemPrompt(): void {
    this.session.systemPrompt = this.defaultSystemPrompt;
    this.logger.debug("System prompt reset to default");
  }

  // --- 会话管理API ---
  public getSession(): Effect.Effect<Session, never> {
    return Effect.succeed(this.session);
  }

  public getHistory() {
    return [...this.session.messages];
  }

  public async clearHistory(): Promise<void> {
    this.session.messages = [];
    await Effect.runPromise(this.sessionManager.updateSession?.(this.session) ?? Effect.succeed(void 0));
    this.logger.info("Session history cleared");
  }

  // --- 生命周期钩子 ---
  protected async beforeRun(input: string, session: Session): Promise<string> {
    return input;
  }

  protected async afterRun(response: string, session: Session): Promise<string> {
    return response;
  }

  protected async onError(error: Error): Promise<void> {
    return;
  }

  // --- 内部工具方法 ---
  protected triggerMiddleware(event: MiddlewareEvents, data: Record<string, unknown>): void {
    if (this.middleware) {
      try {
        Effect.runPromise(this.middleware.execute(event, data));
      } catch {
        // ignore middleware errors
      }
    }
  }
}
