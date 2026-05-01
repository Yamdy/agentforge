import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentForge',
  description: 'Agent 开发框架底座 — 命令式事件驱动 + Zod 类型安全',
  lang: 'zh-CN',
  srcExclude: ['archive/**', 'analysis/**', 'plans/**', 'specs/**', 'project/**', 'design/**', 'DOCUMENTATION.md', 'benchmarks/**', '404.md'],
  ignoreDeadLinks: true,
  // ignoreDeadLinks: true,  // 注释掉以发现潜在链接问题
  
  head: [
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'AgentForge',
    
    nav: [
      { text: '指南', link: '/guide/' },
      { text: 'API 参考', link: '/api/' },
      { text: '架构设计', link: '/architecture/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          collapsed: false,
          items: [
            { text: '简介', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '脚手架工具', link: '/guide/create-agentforge' },
            { text: '核心概念', link: '/guide/core-concepts' },
          ],
        },
        {
          text: '核心模块',
          collapsed: false,
          items: [
            { text: '事件系统', link: '/guide/events' },
            { text: '状态管理', link: '/guide/state' },
            { text: '工具系统', link: '/guide/tools' },
            { text: '插件系统', link: '/guide/plugins' },
          ],
        },
        {
          text: '子系统',
          collapsed: false,
          items: [
            { text: '子 Agent', link: '/guide/subagent' },
            { text: 'MCP 协议', link: '/guide/mcp' },
            { text: '工作流', link: '/guide/workflow' },
          ],
        },
        {
          text: '扩展功能',
          collapsed: false,
          items: [
            { text: '配额控制', link: '/guide/quota' },
            { text: '记忆管理', link: '/guide/memory' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API 概览',
          collapsed: false,
          items: [
            { text: '概览', link: '/api/' },
          ],
        },
        {
          text: '创建 Agent',
          collapsed: false,
          items: [
            { text: 'createAgent', link: '/api/create-agent' },
          ],
        },
        {
          text: '核心类型',
          collapsed: false,
          items: [
            { text: 'AgentEvent', link: '/api/events' },
            { text: 'AgentState', link: '/api/state' },
            { text: 'LLMAdapter', link: '/api/llm-adapter' },
            { text: 'ToolDefinition', link: '/api/tool-definition' },
          ],
        },
        {
          text: 'Quickstart',
          collapsed: false,
          items: [
            { text: 'Quickstart API', link: '/api/quickstart' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '设计文档',
          collapsed: false,
          items: [
            { text: '架构概览', link: '/architecture/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Yamdy/agentforge' },
    ],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024 AgentForge',
    },
  },
});