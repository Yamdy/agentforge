import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { InferhubAdapter } from '../adapters/inferhub.js';

interface AuthEntry {
  type: 'oauth' | 'api' | 'wellknown';
  access?: string;
  key?: string;
  expires?: number;
  accountId?: string;
}

type AuthData = Record<string, AuthEntry>;

/**
 * 获取 opencode auth.json 文件路径
 * Windows 优先检查 %LOCALAPPDATA%，回退到 ~/.local/share/
 */
function getAuthFilePath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const xdgPath = path.join(xdgDataHome, 'opencode', 'auth.json');
  if (os.platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const winPath = path.join(localAppData, 'opencode', 'auth.json');
      if (fs.existsSync(winPath)) return winPath;
    }
    if (fs.existsSync(xdgPath)) return xdgPath;
  }
  return xdgPath;
}

/**
 * 使用 Windows DPAPI 解密 token
 */
async function decryptToken(encryptedBase64: string): Promise<string> {
  if (os.platform() === 'win32') {
    const { Dpapi } = await import('@primno/dpapi');
    return Dpapi.unprotectData(Buffer.from(encryptedBase64, 'base64'), null, 'CurrentUser').toString();
  }
  return encryptedBase64;
}

/**
 * 从 opencode auth.json 读取并解密认证 token
 * 优先级：环境变量 > auth.json
 */
async function getAuthToken(): Promise<string | undefined> {
  const envToken = process.env.INFERHUB_AUTH_TOKEN || process.env.X_AUTH_TOKEN;
  if (envToken) {
    console.log('使用环境变量中的 token');
    return envToken;
  }

  const authFilePath = getAuthFilePath();
  if (!fs.existsSync(authFilePath)) {
    console.warn(`未找到 auth.json 文件: ${authFilePath}`);
    return undefined;
  }

  try {
    const raw = fs.readFileSync(authFilePath, 'utf-8');
    const authData: AuthData = JSON.parse(raw);

    for (const key of ['inferhub-provider', 'w3']) {
      const entry = authData[key];
      if (!entry) continue;

      if (entry.type === 'oauth' && entry.access) {
        try {
          const token = await decryptToken(entry.access);
          if (entry.expires && Date.now() > entry.expires) {
            console.warn(`${key} 的 token 已过期 (expires: ${new Date(entry.expires).toISOString()})`);
            continue;
          }
          console.log(`从 auth.json 读取 ${key} 的 token (accountId: ${entry.accountId ?? 'unknown'})`);
          return token;
        } catch {
          console.warn(`解密 ${key} 的 token 失败`);
          continue;
        }
      }

      if (entry.type === 'api' && entry.key) {
        try {
          const apiKey = await decryptToken(entry.key);
          console.log(`从 auth.json 读取 ${key} 的 API key`);
          return apiKey;
        } catch {
          console.warn(`解密 ${key} 的 API key 失败`);
          continue;
        }
      }
    }

    console.warn('auth.json 中未找到可用的 inferhub-provider 或 w3 认证信息');
    return undefined;
  } catch (err) {
    console.error('读取 auth.json 失败:', err);
    return undefined;
  }
}

async function main() {
  const token = await getAuthToken();
  if (!token) {
    console.error('无法获取认证 token，退出。');
    console.error('请通过以下方式之一提供 token：');
    console.error('  1. 设置 INFERHUB_AUTH_TOKEN 环境变量');
    console.error('  2. 设置 X_AUTH_TOKEN 环境变量');
    console.error('  3. 在 opencode 中登录（auth.json 将自动读取）');
    process.exit(1);
  }

  const adapter = new InferhubAdapter({
    model: 'Glm-4.7-Agent-Dev',
    token,
    tlsRejectUnauthorized: false,
    enableOcHeartbeat: true,
    enableToolStream: true,
    maxTokens: 24000,
    streamOptions: { include_usage: true },
  });

  console.log('发送消息: hello\n');

  adapter.chatStream([{ role: 'user', content: 'hello' }]).subscribe({
    next: (event) => {
      if (event.type === 'text') process.stdout.write(event.content);
    },
    complete: () => console.log('\n完成'),
    error: (err) => console.error('错误:', err),
  });
}

main().catch(console.error);
