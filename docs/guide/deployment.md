# 部署

学习如何将 AgentForge 应用部署到生产环境。

## 构建应用

### TypeScript 构建

```bash
# 构建 TypeScript
pnpm build

# 输出在 dist/ 目录
```

### 配置 tsup

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

## 环境变量

### .env 文件

```env
# API Keys
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Server Config
PORT=3000
HOST=0.0.0.0

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Database (optional)
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

### 加载环境变量

```typescript
import 'dotenv/config';
import { loadConfig } from 'agentforge/config';

const config = await loadConfig();
```

## Docker 部署

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建
RUN pnpm build

# 暴露端口
EXPOSE 3000

# 启动
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  agentforge:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  redis:
    image: redis:alpine
    ports:
      - '6379:6379'
    restart: unless-stopped
```

### 构建和运行

```bash
# 构建镜像
docker build -t agentforge .

# 运行容器
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=sk-xxx \
  agentforge

# 使用 docker-compose
docker-compose up -d
```

## 云平台部署

### Vercel

```typescript
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/dist/index.js"
    }
  ],
  "env": {
    "OPENAI_API_KEY": "@openai_api_key"
  }
}
```

### Railway

```toml
# railway.toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
```

### AWS Lambda

```typescript
// lambda/index.ts
import { createAgent } from 'agentforge';

let agent;

export const handler = async (event) => {
  if (!agent) {
    const config = await loadConfig();
    agent = createAgent(config);
  }

  const { message } = JSON.parse(event.body);
  const result = await agent.run(message);

  return {
    statusCode: 200,
    body: JSON.stringify({ result }),
  };
};
```

## 进程管理

### PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'agentforge',
      script: 'dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs

# 重启应用
pm2 restart agentforge

# 停止应用
pm2 stop agentforge
```

### Systemd

```ini
# /etc/systemd/system/agentforge.service
[Unit]
Description=AgentForge Application
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/agentforge
ExecStart=/usr/bin/node /opt/agentforge/dist/index.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
sudo systemctl enable agentforge

# 启动服务
sudo systemctl start agentforge

# 查看状态
sudo systemctl status agentforge

# 查看日志
sudo journalctl -u agentforge -f
```

## 反向代理

### Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Caddy

```caddyfile
your-domain.com {
    reverse_proxy localhost:3000
}
```

## 监控和日志

### 健康检查

```typescript
import { createServer } from 'http';

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3000);
```

### 日志记录

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

logger.info('Application started');
logger.error('An error occurred', { error });
```

### Prometheus 指标

```typescript
import promClient from 'prom-client';

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpRequestDuration.observe(
      {
        method: req.method,
        route: req.path,
        code: res.statusCode,
      },
      duration / 1000
    );
  });
  next();
});
```

## 安全配置

### CORS

```typescript
import { cors } from '@hono/cors';

app.use(
  cors({
    origin: ['https://your-domain.com'],
    credentials: true,
  })
);
```

### Rate Limiting

```typescript
import { rateLimiter } from 'hono-rate-limiter';

app.use(
  '*',
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  })
);
```

### Helmet

```typescript
import { helmet } from 'hono';

app.use(helmet());
```

## 性能优化

### 缓存

```typescript
import { cache } from 'hono/cache';

app.get(
  '/api/data',
  cache({
    cacheName: 'data-cache',
    cacheControl: 'max-age=3600',
  }),
  async (c) => {
    const data = await fetchData();
    return c.json(data);
  }
);
```

### 压缩

```typescript
import { compress } from 'hono/compress';

app.use(compress());
```

## 完整部署示例

```typescript
// src/server.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from '@hono/cors';
import { logger } from 'hono/logger';
import { loadConfig, createAgent } from 'agentforge';

const app = new Hono();
const config = await loadConfig();
const agent = createAgent(config);

// 中间件
app.use('*', logger());
app.use('*', cors({ origin: '*' }));

// 健康检查
app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: Date.now() });
});

// API 路由
app.post('/api/chat', async (c) => {
  const { message } = await c.req.json();

  try {
    const result = await agent.run(message);
    return c.json({ success: true, result });
  } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 启动服务器
const port = parseInt(process.env.PORT || '3000');
serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running on port ${port}`);
```

## CI/CD

### GitHub Actions

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## 下一步

- [最佳实践](./best-practices.md) - 查看最佳实践
- [API 文档](../api/core.md) - 查看 API 文档
