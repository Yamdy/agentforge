# AgentForge 服务端部署最佳实践

## 部署方式选择

### 1. 开发环境快速部署 (Docker Compose)
```bash
# 1. 复制环境变量配置
cp .env.example .env
# 编辑 .env 填入你的 LLM API Key

# 2. 启动所有服务
docker-compose up -d

# 3. 访问服务
# API 地址: http://localhost:3000
# OpenAPI 文档: http://localhost:3000/openapi.json
```

### 2. 生产环境部署 (SST + AWS)
参考opencode的部署方式，使用SST（Serverless Stack）一键部署到AWS：
```bash
# 1. 安装 SST CLI
npm install -g sst

# 2. 配置 AWS 凭证
aws configure

# 3. 部署到 staging 环境
sst deploy --stage staging

# 4. 部署到 production 环境
sst deploy --stage production
```

### 3. 传统 VPS 部署
```bash
# 1. 安装依赖
npm install -g pnpm

# 2. 构建项目
pnpm install --frozen-lockfile
pnpm run build --filter @agentforge/server

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入生产配置

# 4. 使用 PM2 启动
npm install -g pm2
pm2 start packages/server/dist/index.js --name agentforge-server
```

## 架构最佳实践

### 高可用部署
- **多可用区部署**: 服务、数据库、缓存都部署在多个可用区
- **自动扩缩容**: 根据流量自动调整服务实例数量
- **负载均衡**: 前端使用ALB/CLB做流量分发
- **熔断降级**: 内置服务熔断机制，防止级联故障

### 安全配置
- **HTTPS 强制**: 所有流量走HTTPS，TLS 1.3+
- **JWT 认证**: 所有API接口都需要认证
- **IP 白名单**: 管理后台和内部接口配置IP白名单
- **敏感信息加密**: 数据库中的用户信息、API密钥等敏感数据加密存储
- **WAF 防护**: 生产环境启用Web应用防火墙

### 性能优化
- **Redis 缓存**: 会话数据、常用LLM响应缓存到Redis
- **数据库索引优化**: 为高频查询字段添加索引
- **连接池配置**: 数据库、Redis连接池大小根据实例配置优化
- **静态资源CDN**: 前端静态资源部署到CDN

### 可观测性
- **日志收集**: 所有日志统一收集到CloudWatch/ELK
- **指标监控**: CPU、内存、请求量、延迟、错误率等指标监控
- **链路追踪**: 集成OpenTelemetry做全链路追踪
- **告警配置**: 错误率、延迟超过阈值自动告警

## 配置最佳实践

### 环境变量配置
| 变量名 | 说明 | 示例 |
|--------|------|------|
| `PORT` | 服务监听端口 | `3000` |
| `NODE_ENV` | 运行环境 | `production` |
| `JWT_SECRET` | JWT 签名密钥 | 随机32位以上字符串 |
| `DATABASE_URL` | PostgreSQL 连接地址 | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis 连接地址 | `redis://host:6379` |
| `LLM_API_KEY` | LLM API 密钥 | `sk-xxx` |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.openai.com/v1` |
| `ALLOWED_ORIGINS` | 允许的CORS源 | `https://yourdomain.com` |

### 数据库配置
- PostgreSQL 版本 >= 14
- 连接池大小: 每个实例配置10-20个连接
- 慢查询日志: 开启慢查询日志，阈值1s
- 定期备份: 每日自动全量备份，增量备份每小时一次

### LLM 配置
- 支持多厂商LLM配置，通过环境变量切换
- 配置请求超时: 30s
- 配置重试机制: 最多3次重试，指数退避
- 限流配置: 按照LLM厂商的限额配置限流规则

## 运维最佳实践

### 版本管理
- 所有部署使用语义化版本号
- 生产环境部署前先在staging环境验证
- 保留最近3个版本的部署历史，支持快速回滚

### 灰度发布
- 新功能先放量10%流量验证
- 监控错误率和延迟指标，异常自动回滚
- 全量发布前做性能压测

### 备份与恢复
- 数据库每日自动备份，保留30天
- Redis开启持久化，定期备份RDB文件
- 灾难恢复演练每季度一次

## 扩展能力

### 水平扩展
- 服务层无状态，可任意水平扩展
- 会话数据存储在Redis，支持多实例共享
- MCP服务可独立部署，通过gRPC/HTTP通信

### 插件扩展
- 支持热加载插件，无需重启服务
- 插件权限隔离，防止恶意插件影响主服务
- 插件市场支持一键安装第三方插件
