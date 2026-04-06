// 权限系统
import { Tool } from '../types';

export type PermissionType = 'read' | 'write' | 'execute' | 'delete' | 'admin';

export interface Permission {
  type: PermissionType;
  resource: string;
  allowed: boolean;
}

export interface Role {
  name: string;
  permissions: Permission[];
  description?: string;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  roles: string[];
}

export class PermissionSystem {
  private roles: Map<string, Role> = new Map();
  private users: Map<string, User> = new Map();

  constructor() {
    // 默认角色
    this.createRole(
      'admin',
      [
        { type: 'read', resource: '*', allowed: true },
        { type: 'write', resource: '*', allowed: true },
        { type: 'execute', resource: '*', allowed: true },
        { type: 'delete', resource: '*', allowed: true },
        { type: 'admin', resource: '*', allowed: true },
      ],
      'Administrator role with all permissions'
    );

    this.createRole(
      'user',
      [
        { type: 'read', resource: '/public/*', allowed: true },
        { type: 'read', resource: '/private/user/[userId]/*', allowed: true },
        { type: 'write', resource: '/private/user/[userId]/*', allowed: true },
        { type: 'execute', resource: '/public/tools/*', allowed: true },
      ],
      'Default user role with limited permissions'
    );
  }

  // 创建角色
  createRole(name: string, permissions: Permission[], description?: string): void {
    this.roles.set(name, { name, permissions, description });
  }

  // 获取角色
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  // 删除角色
  deleteRole(name: string): void {
    this.roles.delete(name);
  }

  // 添加用户
  addUser(user: User): void {
    this.users.set(user.id, user);
  }

  // 获取用户
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  // 删除用户
  deleteUser(id: string): void {
    this.users.delete(id);
  }

  // 检查用户是否有权限
  async checkPermission(userId: string, permission: Permission): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    const allUserPermissions = [];
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role) {
        allUserPermissions.push(...role.permissions);
      }
    }

    return allUserPermissions.some((p) => this.matchPermission(p, permission, user));
  }

  // 检查工具是否有权限
  async checkToolPermission(userId: string, tool: Tool, args: any): Promise<boolean> {
    const resource = this.getToolResource(tool, args);
    return this.checkPermission(userId, {
      type: 'execute',
      resource,
      allowed: true,
    });
  }

  // 获取工具资源路径
  private getToolResource(tool: Tool, args: any): string {
    // 简单的资源路径解析
    if (tool.name === 'read' || tool.name === 'write' || tool.name === 'edit') {
      return args.filePath;
    }
    if (tool.name === 'bash' || tool.name === 'execute') {
      return `/tools/${tool.name}`;
    }
    return `/tools/${tool.name}`;
  }

  // 匹配权限
  private matchPermission(pattern: Permission, check: Permission, user: User): boolean {
    if (pattern.type !== check.type) {
      return false;
    }

    if (pattern.allowed !== check.allowed) {
      return false;
    }

    // 资源匹配逻辑
    const resourcePattern = pattern.resource.replace('[userId]', user.id).replace('*', '.*');

    const regex = new RegExp(`^${resourcePattern}$`);
    return regex.test(check.resource);
  }
}

// 全局实例
let _permissionSystem: PermissionSystem | undefined;

export function getPermissionSystem(): PermissionSystem {
  if (!_permissionSystem) {
    _permissionSystem = new PermissionSystem();
  }
  return _permissionSystem;
}

export function setPermissionSystem(system: PermissionSystem): void {
  _permissionSystem = system;
}
