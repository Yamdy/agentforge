import { ISkill, SkillContext, SkillResult } from './skill';
import { Log } from './log';

const logger = Log.create({ service: 'skill-manager' });

/**
 * Skill 管理器配置
 */
export interface SkillManagerConfig {
  /**
   * 是否自动注册内置Skill
   */
  autoRegisterBuiltinSkills?: boolean;
  /**
   * 执行Skill前是否自动校验参数
   */
  autoValidateParams?: boolean;
  /**
   * 是否开启Skill执行日志
   */
  enableExecutionLog?: boolean;
}

/**
 * Skill 执行选项
 */
export interface SkillExecutionOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

/**
 * Skill 管理器
 * 负责Skill的注册、发现、查找、执行
 */
export class SkillManager {
  private skills: Map<string, ISkill> = new Map();
  private config: Required<SkillManagerConfig>;

  constructor(config: SkillManagerConfig = {}) {
    this.config = {
      autoRegisterBuiltinSkills: true,
      autoValidateParams: true,
      enableExecutionLog: true,
      ...config,
    };

    if (this.config.autoRegisterBuiltinSkills) {
      this.registerBuiltinSkills();
    }
  }

  /**
   * 注册单个Skill
   */
  public register(skill: ISkill): void {
    if (this.skills.has(skill.meta.id)) {
      logger.warn(`Skill [${skill.meta.id}] 已存在，将被覆盖`);
    }
    this.skills.set(skill.meta.id, skill);
    if (this.config.enableExecutionLog) {
      logger.info(`Skill [${skill.meta.id}] 注册成功`);
    }
  }

  /**
   * 批量注册Skill
   */
  public registerAll(skills: ISkill[]): void {
    skills.forEach(skill => this.register(skill));
  }

  /**
   * 取消注册Skill
   */
  public unregister(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  /**
   * 查找Skill
   */
  public getSkill(skillId: string): ISkill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取所有注册的Skill
   */
  public getAllSkills(): ISkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取所有Skill的Function定义（用于LLM工具调用）
   */
  public getFunctionDefinitions() {
    return this.getAllSkills().map(skill => skill.toFunctionDefinition());
  }

  /**
   * 执行Skill
   */
  public async execute(
    skillId: string,
    ctx: SkillContext,
    params: any,
    options: SkillExecutionOptions = {}
  ): Promise<SkillResult> {
    const skill = this.getSkill(skillId);
    if (!skill) {
      return { success: false, error: `Skill [${skillId}] 未找到` };
    }

    const timer = logger.time(`执行Skill [${skillId}]`, { params: JSON.stringify(params) });
    try {
      const result = await skill.run(ctx, params);
      timer.stop();
      return result;
    } catch (error) {
      logger.error(`Skill [${skillId}] 执行失败`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * 按分类查询Skill
   */
  public getSkillsByCategory(category: string): ISkill[] {
    return this.getAllSkills().filter(skill => skill.meta.category === category);
  }

  /**
   * 按标签查询Skill
   */
  public getSkillsByTag(tag: string): ISkill[] {
    return this.getAllSkills().filter(skill => skill.meta.tags?.includes(tag) ?? false);
  }

  /**
   * 搜索Skill（按名称/描述/标签）
   */
  public searchSkills(keyword: string): ISkill[] {
    const kw = keyword.toLowerCase();
    return this.getAllSkills().filter(skill =>
      skill.meta.name.toLowerCase().includes(kw) ||
      skill.meta.description.toLowerCase().includes(kw) ||
      skill.meta.tags?.some(t => t.toLowerCase().includes(kw))
    );
  }

  /**
   * 注册内置Skill（基础工具类）
   */
  private registerBuiltinSkills(): void {
    // 内置Skill后续可以在这里注册，比如计算器、时间获取、字符串处理等
  }
}
