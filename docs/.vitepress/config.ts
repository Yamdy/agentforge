import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentForge',
  description: 'TypeScript framework for building AI applications, agents, and workflows',
  lang: 'zh-CN',

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '指南', link: '/guide/configuration' },
      { text: 'API', link: '/api/core' },
      { text: '示例', link: '/examples/basic' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '安装', link: '/guide/installation' },
            { text: '项目结构', link: '/guide/project-structure' },
          ],
        },
        {
          text: '核心概念',
          items: [
            { text: '配置系统', link: '/guide/configuration' },
            { text: 'Agent', link: '/guide/agent' },
            { text: '工具系统', link: '/guide/tools' },
            { text: '中间件', link: '/guide/middleware' },
            { text: '权限管理', link: '/guide/permissions' },
            { text: '流式响应', link: '/guide/streaming' },
          ],
        },
        {
          text: '高级功能',
          items: [
            { text: '自定义工具', link: '/guide/custom-tools' },
            { text: '自定义适配器', link: '/guide/custom-adapters' },
            { text: '插件系统', link: '/guide/plugins' },
            { text: '测试', link: '/guide/testing' },
          ],
        },
        {
          text: '部署',
          items: [
            { text: '生产环境', link: '/guide/deployment' },
            { text: '最佳实践', link: '/guide/best-practices' },
          ],
        },
      ],
      '/api/': [
        {
          text: '核心 API',
          items: [
            { text: 'Agent', link: '/api/core' },
            { text: '配置', link: '/api/config' },
            { text: '工具', link: '/api/tools' },
            { text: '存储', link: '/api/storage' },
          ],
        },
        {
          text: '适配器',
          items: [
            { text: 'AI 适配器', link: '/api/adapters' },
            { text: 'MCP 适配器', link: '/api/mcp' },
          ],
        },
        {
          text: '工具类',
          items: [
            { text: '权限系统', link: '/api/permissions' },
            { text: '中间件', link: '/api/middleware' },
          ],
        },
      ],
      '/examples/': [
        {
          text: '基础示例',
          items: [
            { text: '基本 Agent', link: '/examples/basic' },
            { text: '流式响应', link: '/examples/streaming' },
            { text: '工具使用', link: '/examples/tools' },
          ],
        },
        {
          text: '进阶示例',
          items: [
            { text: '自定义工具', link: '/examples/custom-tools' },
            { text: '中间件链', link: '/examples/middleware' },
            { text: '权限控制', link: '/examples/permissions' },
          ],
        },
        {
          text: '完整示例',
          items: [
            { text: '代码助手', link: '/examples/code-assistant' },
            { text: '数据分析', link: '/examples/data-analysis' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/your-org/agentforge' }],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024 AgentForge Team',
    },

    search: {
      provider: 'local',
    },
  },

  markdown: {
    codeTransformers: [
      {
        post: (code, node) => {
          if (/\b[vue]\b/.test(node.props?.['class'])) {
            return code.replace(/export default/g, 'const __default__ =');
          }
        },
      },
    ],
  },
});
