import { z, ZodSchema } from 'zod';

/**
 * Skill 参数定义
 */
export interface SkillParameter<T = any> {
  name: string;
  description: string;
  schema: ZodSchema<T>;
  required?: boolean;
  default?: T;
}

/**
 * Skill 执行上下文
 */
export interface SkillContext {
  agentId: string;
  sessionId: string;
  userId?: string;
  variables: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Skill 执行结果
 */
export interface SkillResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Skill 元信息
 */
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  category?: string;
  author?: string;
  version: string;
  tags?: string[];
  icon?: string;
  deprecated?: boolean;
}

/**
 * Skill 接口定义
 */
export interface ISkill<Input = any, Output = any> {
  /**
   * Skill 元信息
   */
  meta: SkillMeta;

  /**
   * 参数定义
   */
  parameters: SkillParameter[];

  /**
   * 前置钩子：执行前调用，可用于参数校验、权限校验、日志记录等
   */
  preExecute?: (ctx: SkillContext, params: Input) => Promise<Input> | Input;

  /**
   * 核心执行逻辑
   */
  execute: (ctx: SkillContext, params: Input) => Promise<Output> | Output;

  /**
   * 后置钩子：执行后调用，可用于结果处理、日志记录、指标上报等
   */
  postExecute?: (ctx: SkillContext, params: Input, result: Output) => Promise<Output> | Output;

  /**
   * 错误处理钩子：执行异常时调用
   */
  onError?: (ctx: SkillContext, params: Input, error: Error) => Promise<Output> | Output;

  /**
   * 执行Skill完整流程（包含前置/核心/后置钩子）
   */
  run(ctx: SkillContext, params: Input): Promise<SkillResult<Output>>;

  /**
   * 转换为OpenAI Function格式，方便LLM调用
   */
  toFunctionDefinition(): any;
}

/**
 * Skill 定义配置（用于快速创建Skill）
 */
export interface SkillConfig<Input = any, Output = any> {
  meta: Omit<SkillMeta, 'version'> & { version?: string };
  parameters: SkillParameter[];
  execute: (ctx: SkillContext, params: Input) => Promise<Output> | Output;
  preExecute?: (ctx: SkillContext, params: Input) => Promise<Input> | Input;
  postExecute?: (ctx: SkillContext, params: Input, result: Output) => Promise<Output> | Output;
  onError?: (ctx: SkillContext, params: Input, error: Error) => Promise<Output> | Output;
}

/**
 * 简单Skill 实现类，简化自定义Skill开发
 */
export class Skill<Input = any, Output = any> implements ISkill<Input, Output> {
  public readonly meta: SkillMeta;
  public readonly parameters: SkillParameter[];
  public readonly preExecute?: (ctx: SkillContext, params: Input) => Promise<Input> | Input;
  public readonly execute: (ctx: SkillContext, params: Input) => Promise<Output> | Output;
  public readonly postExecute?: (ctx: SkillContext, params: Input, result: Output) => Promise<Output> | Output;
  public readonly onError?: (ctx: SkillContext, params: Input, error: Error) => Promise<Output> | Output;

  constructor(config: SkillConfig<Input, Output>) {
    this.meta = {
      version: '0.1.0',
      ...config.meta,
    };

    this.parameters = config.parameters.map(p => ({
      required: true,
      ...p,
    }));

    this.preExecute = config.preExecute;
    this.execute = config.execute;
    this.postExecute = config.postExecute;
    this.onError = config.onError;
  }

  /**
   * 执行Skill完整流程（包含前置/核心/后置钩子）
   */
  public async run(ctx: SkillContext, params: Input): Promise<SkillResult<Output>> {
    let currentParams = params;
    // 1. 执行前置钩子
    if (this.preExecute) {
      try {
        currentParams = await this.preExecute(ctx, currentParams);
      } catch (e) {
        const error = e as Error;
        if (this.onError) {
          const fallbackData = await this.onError(ctx, currentParams, error);
          return { success: true, data: fallbackData };
        }
        return { success: false, error: error.message };
      }
    }

    // 2. 执行核心逻辑
    let result: Output;
    try {
      result = await this.execute(ctx, currentParams);
    } catch (e) {
      const error = e as Error;
      if (this.onError) {
        const fallbackData = await this.onError(ctx, currentParams, error);
        return { success: true, data: fallbackData };
      }
      return { success: false, error: error.message };
    }

    // 3. 执行后置钩子
    if (this.postExecute) {
      try {
        result = await this.postExecute(ctx, currentParams, result);
      } catch (e) {
        const error = e as Error;
        if (this.onError) {
          const fallbackData = await this.onError(ctx, currentParams, error);
          return { success: true, data: fallbackData };
        }
        return { success: false, error: error.message };
      }
    }

    return { success: true, data: result };
  }

  /**
   * 转换为OpenAI Function格式，方便LLM调用
   */
  public toFunctionDefinition() {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of this.parameters) {
      properties[param.name] = {
        description: param.description,
        ...param.schema._def,
      };
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'function' as const,
      function: {
        name: this.meta.id,
        description: this.meta.description,
        parameters: {
          type: 'object' as const,
          properties,
          required,
        },
      },
    };
  }
}
