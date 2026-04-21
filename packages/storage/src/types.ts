import type { Effect } from "effect";
import { SessionError } from "@agentforge/core";

/**
 * 存储错误类型
 */
export class StorageError extends SessionError {
  name = "StorageError" as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * 存储接口抽象，所有存储实现都要遵循这个接口
 */
export interface Storage {
  /**
   * 读取指定键的数据
   * @param key 键路径，如 ["session", "abc123"]
   * @returns 解析后的数据
   */
  read: <T>(key: string[]) => Effect.Effect<T, StorageError>;

  /**
   * 写入数据到指定键
   * @param key 键路径
   * @param data 要写入的数据，必须可以序列化为JSON
   */
  write: <T>(key: string[], data: T) => Effect.Effect<void, StorageError>;

  /**
   * 更新数据（原子操作：读取-修改-写入）
   * @param key 键路径
   * @param updater 修改函数，直接修改draft对象，无需返回
   * @returns 修改后的数据
   */
  update: <T>(key: string[], updater: (draft: T) => void) => Effect.Effect<T, StorageError>;

  /**
   * 删除指定键的数据
   * @param key 键路径
   */
  remove: (key: string[]) => Effect.Effect<void, StorageError>;

  /**
   * 列出指定前缀下的所有键
   * @param prefix 键前缀路径
   * @returns 匹配的键路径数组
   */
  list: (prefix: string[]) => Effect.Effect<string[][], StorageError>;
}

/**
 * 文件存储配置
 */
export interface FileStorageConfig {
  /**
   * 存储根目录，默认 ~/.agentforge/storage
   */
  rootDir?: string;
  /**
   * 数据加密密钥，256位字符串，提供则自动加密敏感字段
   */
  encryptionKey?: string;
  /**
   * 需要加密的字段，默认 ["content", "tool_calls", "metadata"]
   */
  encryptFields?: string[];
  /**
   * 自动清理配置
   */
  autoCleanup?: {
    /**
     * 会话最大保留时间（毫秒），超过自动删除
     */
    maxSessionAge?: number;
    /**
     * 日志最大保留时间（毫秒），超过自动删除
     */
    maxLogAge?: number;
    /**
     * 最大保留会话数，超过自动删除最旧的
     */
    maxSessions?: number;
  };
  /**
   * 缓存大小，默认 100，设置为0关闭缓存
   */
  cacheSize?: number;
}

/**
 * 持久化会话管理器配置
 */
export interface PersistentSessionManagerConfig {
  /**
   * 存储实例
   */
  storage: Storage;
  /**
   * 每个会话最多保留消息数，默认 200
   */
  maxMessagesPerSession?: number;
  /**
   * 是否自动裁剪消息，默认 true
   */
  autoTrim?: boolean;
  /**
   * 自动裁剪时保留的最新消息数，默认 100
   */
  trimKeepCount?: number;
}

/**
 * 持久化检查点配置
 */
export interface PersistentCheckpointerConfig {
  /**
   * 存储实例
   */
  storage: Storage;
  /**
   * 每个会话最多保留的检查点数量，默认 10，超过自动删除最旧的
   */
  maxCheckpointsPerSession?: number;
}
