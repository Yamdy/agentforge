# Plan: Skill Discovery Enhancement

**Source PRD**: `.claude/prds/skill-discovery-enhancement.prd.md`
**Selected Milestone**: 1 - 配置路径支持
**Complexity**: Small

## Summary
在配置文件中添加 `skills.paths` 字段，让开发者可以通过配置声明额外的技能目录。现有 `resolveSkillDirectories` 已支持 `extraSkillDirs` 参数，只需将其与配置文件关联。

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Naming | `packages/sdk/src/index.ts:712` | `HarnessConfig` 接口定义配置字段 |
| Validation | `packages/core/src/config.ts:167` | Zod schema `HarnessConfigSchema` 验证配置 |
| Loading | `packages/server/src/config-loader.ts:88` | `loadAndRegister` 从配置构建运行时参数 |
| Tests | `packages/server/__tests__/discovery.test.ts:39` | Vitest 单元测试，describe/it 模式 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `packages/sdk/src/index.ts` | UPDATE | 添加 `skills.paths` 到 `HarnessConfig` 接口 |
| `packages/core/src/config.ts` | UPDATE | 添加 `skills.paths` 到 Zod schema |
| `packages/server/src/config-loader.ts` | UPDATE | 读取 `skills.paths` 并传给 `resolveSkillDirectories` |
| `packages/server/__tests__/discovery.test.ts` | UPDATE | 添加配置路径测试用例 |

## Tasks

### Task 1: 扩展 HarnessConfig 接口
- **Action**: 在 `packages/sdk/src/index.ts` 的 `HarnessConfig` 接口中添加 `skills?: { paths?: string[] }`
- **Mirror**: 参考 `modelGateways` 字段的定义方式
- **Validate**: `pnpm --filter @primo-ai/sdk build`

### Task 2: 扩展 Zod Schema
- **Action**: 在 `packages/core/src/config.ts` 的 `HarnessConfigSchema` 中添加 `skills` 字段验证
- **Mirror**: 参考 `modelGateways` 的 Zod schema 写法
- **Validate**: `pnpm --filter @primo-ai/core build`

### Task 3: 关联配置与发现
- **Action**: 在 `packages/server/src/config-loader.ts` 的 `loadAndRegister` 中读取 `config.skills.paths`，传入 `resolveSkillDirectories` 的 `extraSkillDirs`
- **Mirror**: 现有 `discoveryOpts?.extraSkillDirs` 已在调用，只需从配置读取
- **Validate**: `pnpm --filter @primo-ai/server build`

### Task 4: 添加测试用例
- **Action**: 在 `packages/server/__tests__/discovery.test.ts` 添加测试：配置文件中的 `skills.paths` 被正确读取并加入扫描目录
- **Mirror**: 现有 `resolveSkillDirectories` 测试模式
- **Validate**: `pnpm --filter @primo-ai/server test`

## Validation
```bash
# 构建所有包
pnpm build

# 运行测试
pnpm test

# 类型检查
pnpm check-types
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| 与 OpenCode 配置格式不一致 | Low | OpenCode 用 `skills.paths`，我们保持一致 |
| 配置路径不存在 | Low | `discoverSkills` 已优雅处理不存在的目录 |

## Acceptance
- [ ] `HarnessConfig` 接口包含 `skills.paths` 字段
- [ ] Zod schema 验证通过
- [ ] `loadAndRegister` 读取配置并传递给 `resolveSkillDirectories`
- [ ] 测试用例覆盖配置路径场景
- [ ] `pnpm build` 和 `pnpm test` 通过

---

## Note: Milestone 2 Already Complete

`resolveSkillDirectories` 已包含 `~/.agents/skills/` 和 `~/.claude/skills/` 等目录（通过 `agentsConvention` 选项）。里程碑 2 无需额外开发，只需更新文档。
