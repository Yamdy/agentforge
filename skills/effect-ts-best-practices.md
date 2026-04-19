
# Effect-TS 4.0 最佳实践（参考 Opencode）

## 概览
本文档记录了 Opencode 项目中使用 Effect-TS 4.0 的最佳实践，是我们日常开发的参考标准。所有 Effect-TS 代码都应该遵循这些规范，确保代码质量、一致性和可维护性。

---

## 1. 管道结构与操作规范
### 最佳实践
- **始终使用 `pipe()`** 进行 Effect 链式调用，禁止嵌套 Effect 调用
- 保持每个管道步骤单一职责，不要在一个步骤中做太多事情
- 公共逻辑抽成独立的辅助函数，提高复用性
- 管道步骤之间要保持良好的缩进，提高可读性

### 正确示例
```typescript
import { Effect, pipe } from "effect"

const goodProgram = pipe(
  Effect.succeed(1),
  Effect.map(n => n + 1),
  Effect.map(res => res * 2),
  Effect.tap(res => Effect.log(`Result: ${res}`))
)
```

### 错误示例
```typescript
// 不要这样写：嵌套调用，可读性差
const badProgram = Effect.flatMap(
  Effect.succeed(1), 
  (n) => Effect.map(
    Effect.succeed(n + 1), 
    (res) => res * 2
  )
)
```

---

## 2. 错误处理规范
### 最佳实践
- **所有自定义错误都使用 `Data.TaggedError`** 定义，自带 `_tag` 鉴别属性
- 使用 `mapError` 将低级错误转换为领域错误
- 使用 `catchTag` 处理特定类型的错误，不要使用 `catchAll` 除非确实需要处理所有错误
- 错误类型要明确，不要使用 `any` 或者 `unknown` 类型的错误
- 禁止裸抛异常，所有错误都要走 Effect 的错误通道

### 正确示例
```typescript
import { Effect, Data } from "effect"

// 定义自定义错误
class NetworkError extends Data.TaggedError("NetworkError")<{ message: string; cause?: unknown }> {}
class ParseError extends Data.TaggedError("ParseError")<{ response: string; cause?: unknown }> {}

const fetchData = pipe(
  Effect.tryPromise(() => fetch("https://api.example.com/data")),
  Effect.mapError(err => new NetworkError({ message: `请求失败: ${err}`, cause: err })),
  Effect.flatMap(res => Effect.tryPromise(() => res.text())),
  Effect.flatMap(text => 
    Effect.try({
      try: () => JSON.parse(text),
      catch: (err) => new ParseError({ response: text, cause: err })
    })
  ),
  Effect.catchTag("NetworkError", err => 
    pipe(
      Effect.logError(`网络问题: ${err.message}`),
      Effect.andThen(Effect.succeed({ fallback: true }))
    )
  )
)
```

---

## 3. 异步操作规范
### 最佳实践
- 所有异步操作都必须使用 Effect 封装，禁止直接使用 Promise
- 使用 `Effect.tryPromise()` 封装会抛出异常的异步操作
- 使用 `Effect.promise()` 封装不会抛出异常的异步操作
- 不要在 Effect 内部直接 await Promise，应该使用 Effect 的组合子
- 异步操作的错误必须明确处理，不要忽略

### 正确示例
```typescript
import { Effect } from "effect"
import fs from "node:fs/promises"

const readFile = (path: string) => Effect.tryPromise({
  try: () => fs.readFile(path, "utf8"),
  catch: err => new FileReadError({ path, cause: err })
})

const program = pipe(
  readFile("config.json"),
  Effect.flatMap(content => Effect.try(() => JSON.parse(content)))
)
```

### 错误示例
```typescript
// 不要这样写：返回 Promise 而不是值，破坏类型安全
const badReadFile = (path: string) => Effect.sync(async () => {
  return await fs.readFile(path, "utf8")
})
```

---

## 4. 状态管理规范
### 最佳实践
- 依赖和配置使用 `Context.GenericTag()` 进行依赖注入
- 可变状态使用 `Ref` 或 `ScopedRef` 进行管理
- 有生命周期的状态使用 `ScopedRef`，自动处理清理逻辑
- 禁止使用普通的 mutable 变量保存状态，所有状态变更都要通过 Effect 操作

### 正确示例
```typescript
import { Effect, Context, Ref } from "effect"

// 配置服务定义
class Config extends Context.GenericTag<Config, { apiKey: string; baseUrl: string }>("Config") {}

// 状态管理示例
const counterProgram = pipe(
  Ref.make(0),
  Effect.flatMap(counter =>
    pipe(
      Ref.update(counter, n => n + 1),
      Effect.flatMap(() => Ref.get(counter)),
      Effect.tap(count => Effect.log(`当前计数: ${count}`))
    )
  ),
  // 注入依赖
  Effect.provideService(Config, { apiKey: "test-key", baseUrl: "https://api.example.com" })
)
```

---

## 5. 中间件/拦截器规范
### 最佳实践
- 中间件使用"Around"模式：接收 `next` 函数，返回包装后的函数
- 前置逻辑在调用 `next` 之前执行，后置逻辑在调用 `next` 之后执行
- 中间件要保持可组合性，可以多个中间件链式叠加
- 中间件不要修改传入的参数，应该返回新的对象

### 正确示例
```typescript
import { Effect, pipe } from "effect"

// 计时中间件
const timingMiddleware = (next: (context: Context) => Effect.Effect<Result, Error>) => {
  return (context: Context) => {
    const start = Date.now();
    return pipe(
      next(context),
      Effect.tap(result => {
        const duration = Date.now() - start;
        console.log(`处理 ${context.event} 耗时 ${duration}ms`);
        return Effect.unit;
      })
    )
  }
}
```

---

## 6. 常用工具函数说明
Opencode 经常使用这些 Effect 工具函数，我们也应该优先使用：

| 函数 | 用途 |
|------|------|
| `Effect.tap()` | 执行副作用（日志、验证等），不改变返回值 |
| `Effect.as()` | 将成功值替换为常量 |
| `Effect.unit()` | 返回成功的空Effect，等价于 `Effect.succeed(undefined)` |
| `Effect.all()` | 并行/串行执行多个Effect |
| `Effect.retry()` | 为失败的操作添加重试逻辑 |
| `Effect.timeout()` | 为长时间运行的操作添加超时 |
| `Effect.orDie()` | 将错误转换为致命缺陷，终止执行 |
| `Effect.flatMap()` | 链式组合Effect操作 |
| `Effect.map()` | 转换成功值 |
| `Effect.mapError()` | 转换错误值 |

---

## 7. 测试规范
### 最佳实践
- 使用 `Effect.runPromise` 或 `Effect.runSync` 执行测试中的Effect
- 使用 `provideService` 替换真实依赖为 Mock 实现
- 显式测试成功路径和错误路径
- 优先使用 Effect 原生的断言工具

### 正确示例
```typescript
import { Effect, expect } from "effect/test"

it("应该正确计数", () =>
  Effect.runPromise(pipe(
    Ref.make(0),
    Effect.flatMap(counter => Ref.update(counter, n => n + 1)),
    Effect.flatMap(counter => Ref.get(counter)),
    Effect.andThen(count => expect(count).toBe(1))
  ))
)
```

---

## 8. 禁止使用的反模式
1. ❌ 禁止使用 `any` 类型，所有Effect都要有明确的成功/错误/依赖类型
2. ❌ 禁止在没有充分理由的情况下使用 `@ts-ignore` 或禁用 ESLint 规则
3. ❌ 禁止嵌套 Effect 调用，必须用 pipe 转换成线性流
4. ❌ 禁止在 Effect 外部执行副作用，所有副作用都要封装在Effect中
5. ❌ 禁止使用 v2/v3 版本的旧 API，比如 `Effect.attempt`、`Effect.chain` 等，要用对应的新API：`Effect.try`、`Effect.flatMap`
6. ❌ 禁止不必要的吞错，catchTag 只处理你能处理的错误，其他错误应该往上抛
7. ❌ 禁止硬编码依赖，所有外部依赖都要通过 Context 注入，方便测试和替换

---

## 参考链接
- [Effect-TS 官方文档](https://effect.website/docs/introduction)
- [Opencode 源代码](https://github.com/Effect-TS/opencode)
