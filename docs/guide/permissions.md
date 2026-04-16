# 权限管理

AgentForge 提供了基于角色的权限管理系统，可以细粒度控制 Agent 的操作。

## 基本概念

### 角色（Role）

角色定义了一组权限，可以分配给用户或 Agent。

### 权限（Permission）

权限定义了对特定资源的访问权限。

### 用户（User）

用户可以拥有多个角色，继承所有角色的权限。

## 初始化权限系统

```typescript
import { getPermissionSystem } from 'agentforge/permissions';

const permissionSystem = getPermissionSystem();
```

## 创建角色

```typescript
permissionSystem.createRole('admin', [
  { type: 'read', resource: '/*', allowed: true },
  { type: 'write', resource: '/*', allowed: true },
  { type: 'execute', resource: '/*', allowed: true },
  { type: 'delete', resource: '/*', allowed: true },
]);

permissionSystem.createRole('developer', [
  { type: 'read', resource: '/*', allowed: true },
  { type: 'write', resource: '/src/*', allowed: true },
  { type: 'execute', resource: '/tools/*', allowed: true },
  { type: 'delete', resource: '/tmp/*', allowed: true },
]);

permissionSystem.createRole('user', [
  { type: 'read', resource: '/public/*', allowed: true },
  { type: 'write', resource: '/user/*', allowed: true },
]);
```

## 创建用户

```typescript
permissionSystem.addUser({
  id: 'user1',
  name: 'John Doe',
  email: 'john@example.com',
  roles: ['user'],
});

permissionSystem.addUser({
  id: 'user2',
  name: 'Jane Smith',
  email: 'jane@example.com',
  roles: ['user', 'developer'],
});
```

## 检查权限

```typescript
// 检查用户权限
const hasPermission = await permissionSystem.checkPermission('user1', {
  type: 'write',
  resource: '/src/app.ts',
  allowed: true,
});

console.log(hasPermission); // false - user1 没有 developer 角色

// 检查用户权限
const hasPermission2 = await permissionSystem.checkPermission('user2', {
  type: 'write',
  resource: '/src/app.ts',
  allowed: true,
});

console.log(hasPermission2); // true - user2 有 developer 角色
```

## 权限类型

### read - 读取权限

```typescript
{ type: 'read', resource: '/path/to/file', allowed: true }
```

### write - 写入权限

```typescript
{ type: 'write', resource: '/path/to/file', allowed: true }
```

### execute - 执行权限

```typescript
{ type: 'execute', resource: '/tool/name', allowed: true }
```

### delete - 删除权限

```typescript
{ type: 'delete', resource: '/path/to/file', allowed: true }
```

## 资源模式

支持通配符模式：

```typescript
// 匹配所有文件
'/*';

// 匹配特定目录下的所有文件
'/src/*';

// 匹配特定文件类型
'/*.ts';

// 匹配特定子目录
'/src/components/*';
```

## 工具权限

可以为工具设置权限要求：

```typescript
export const adminTool: Tool = {
  name: 'admin_tool',
  description: '管理员工具',
  permissions: ['admin'], // 需要管理员权限
  async execute(args) {
    // 执行管理员操作
  },
};
```

## 在 Agent 中使用权限

```typescript
import { getPermissionSystem } from 'agentforge/permissions';

const permissionSystem = getPermissionSystem();
const agent = createAgent(config);

// 设置当前用户
agent.context.user = {
  id: 'user1',
  roles: ['user'],
};

// 检查工具调用权限
agent.on('tool_call', async (toolCall) => {
  const hasPermission = await permissionSystem.checkPermission(agent.context.user.id, {
    type: 'execute',
    resource: `/tools/${toolCall.tool.name}`,
    allowed: true,
  });

  if (!hasPermission) {
    throw new Error(`没有权限执行工具: ${toolCall.tool.name}`);
  }
});
```

## 默认角色

AgentForge 提供了两个默认角色：

### admin - 管理员

拥有所有权限：

```typescript
{ type: '*', resource: '*', allowed: true }
```

### user - 普通用户

拥有基本权限：

```typescript
[
  { type: 'read', resource: '/public/*', allowed: true },
  { type: 'write', resource: '/user/*', allowed: true },
];
```

## 权限继承

用户继承所有角色的权限：

```typescript
// 用户拥有 user 和 developer 角色
permissionSystem.addUser({
  id: 'user3',
  name: 'Alice',
  email: 'alice@example.com',
  roles: ['user', 'developer'],
});

// user3 同时拥有 user 和 developer 的权限
```

## 动态权限

可以动态添加权限到角色：

```typescript
permissionSystem.addPermissionToRole('developer', {
  type: 'read',
  resource: '/config/*',
  allowed: true,
});
```

## 权限检查中间件

```typescript
const permissionMiddleware: Middleware = {
  name: 'permission',
  async beforeToolCall(context) {
    const { user, tool } = context;

    const hasPermission = await permissionSystem.checkPermission(user.id, {
      type: 'execute',
      resource: `/tools/${tool.name}`,
      allowed: true,
    });

    if (!hasPermission) {
      throw new Error(`权限不足: ${tool.name}`);
    }
  },
};

agent.use(permissionMiddleware);
```

## 完整示例

```typescript
import { getPermissionSystem } from 'agentforge/permissions';
import { createAgent } from 'agentforge';

// 初始化权限系统
const permissionSystem = getPermissionSystem();

// 创建角色
permissionSystem.createRole('admin', [{ type: '*', resource: '*', allowed: true }]);

permissionSystem.createRole('developer', [
  { type: 'read', resource: '/*', allowed: true },
  { type: 'write', resource: '/src/*', allowed: true },
  { type: 'execute', resource: '/tools/*', allowed: true },
]);

// 创建用户
permissionSystem.addUser({
  id: 'dev1',
  name: 'Developer One',
  email: 'dev1@example.com',
  roles: ['developer'],
});

// 创建 Agent
const agent = createAgent({
  agent: {
    name: 'Secure Agent',
    model: 'gpt-4o',
  },
});

// 设置用户上下文
agent.context.user = {
  id: 'dev1',
  roles: ['developer'],
};

// 添加权限检查中间件
agent.use({
  name: 'permission-check',
  async beforeToolCall(context) {
    const hasPermission = await permissionSystem.checkPermission(context.user.id, {
      type: 'execute',
      resource: `/tools/${context.tool.name}`,
      allowed: true,
    });

    if (!hasPermission) {
      throw new Error(`权限不足: ${context.tool.name}`);
    }
  },
});

// 运行 Agent
const result = await agent.run('读取 src 目录');
```

## 下一步

- [流式响应](./streaming.md) - 了解流式响应
- [自定义工具](./custom-tools.md) - 创建自定义工具
