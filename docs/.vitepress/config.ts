import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentForge',
  description: 'Production-ready Agent framework based on RxJS event stream + Zod type safety',
  lang: 'zh-CN',
  srcDir: 'docs',
  srcExclude: ['architecture/RXJS-EVENT-STREAM-DESIGN/**'],  // 排除技术设计文档
  
  head: [
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'AgentForge' }],
    ['meta', { name: 'og:description', content: 'Production-ready Agent framework' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'AgentForge',
    
    nav: [
      { text: '指南', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'API 参考', link: '/api/', activeMatch: '/api/' },
      { text: '架构设计', link: '/architecture/', activeMatch: '/architecture/' },
      { text: 'GitHub', link: 'https://github.com/your-org/agentforge' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '简介', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '核心概念', link: '/guide/core-concepts' },
          ],
        },
        {
          text: '基础功能',
          items: [
            { text: '事件系统', link: '/guide/events' },
            { text: '状态管理', link: '/guide/state' },
            { text: '工具注册', link: '/guide/tools' },
            { text: 'LLM 适配器', link: '/guide/llm-adapters' },
          ],
        },
        {
          text: '高级功能',
          items: [
            { text: '插件系统', link: '/guide/plugins' },
            { text: '子 Agent', link: '/guide/subagent' },
            { text: 'MCP 集成', link: '/guide/mcp' },
            { text: '工作流', link: '/guide/workflow' },
          ],
        },
        {
          text: '生产部署',
          items: [
            { text: '配额控制', link: '/guide/quota' },
            { text: '安全最佳实践', link: '/guide/security' },
            { text: '可观测性', link: '/guide/observability' },
          ],
        },
      ],
      '/api/': [
        {
          text: '核心 API',
          items: [
            { text: 'createAgent', link: '/api/create-agent' },
            { text: 'AgentEvent', link: '/api/events' },
            { text: 'AgentState', link: '/api/state' },
            { text: 'LLMAdapter', link: '/api/llm-adapter' },
          ],
        },
        {
          text: '接口定义',
          items: [
            { text: 'ToolDefinition', link: '/api/tool-definition' },
            { text: 'ToolRegistry', link: '/api/tool-registry' },
            { text: 'CheckpointStorage', link: '/api/checkpoint' },
            { text: 'HITLController', link: '/api/hitl' },
          ],
        },
        {
          text: '插件 API',
          items: [
            { text: 'InterceptorPlugin', link: '/api/interceptor-plugin' },
            { text: 'ObserverPlugin', link: '/api/observer-plugin' },
            { text: 'PluginContext', link: '/api/plugin-context' },
          ],
        },
        {
          text: '操作符',
          items: [
            { text: '控制流操作符', link: '/api/operators-control' },
            { text: '变换操作符', link: '/api/operators-transform' },
            { text: '通知操作符', link: '/api/operators-notify' },
            { text: '预设', link: '/api/presets' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '设计文档',
          items: [
            { text: '架构概览', link: '/architecture/' },
            { text: '事件流设计', link: '/architecture/event-stream' },
            { text: '状态机', link: '/architecture/state-machine' },
            { text: '依赖注入', link: '/architecture/di' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/agentforge' },
    ],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024-present AgentForge Team',
    },

    editLink: {
      pattern: 'https://github.com/your-org/agentforge/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    outline: {
      label: '页面导航',
    },

    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
});
