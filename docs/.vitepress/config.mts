import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentForge',
  description: 'TypeScript Agent 框架 — Processor Pipeline 模型',
  lang: 'zh-CN',

  cleanUrls: true,
  lastUpdated: true,

  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],

  themeConfig: {
    nav: [
      { text: '指南', link: '/getting-started' },
      { text: 'API', link: '/api-reference' },
      { text: '插件', link: '/plugins' },
    ],

    sidebar: {
      '/': [
        {
          text: '开始',
          items: [
            { text: '快速入门', link: '/getting-started' },
            { text: '配置', link: '/configuration' },
          ],
        },
        {
          text: '核心',
          items: [
            { text: '插件开发', link: '/plugins' },
            { text: 'API 参考', link: '/api-reference' },
            { text: 'A2A 协议', link: '/a2a-protocol' },
          ],
        },
        {
          text: '运维',
          items: [
            { text: '部署', link: '/deployment' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/user/agentforge' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'MIT License',
    },
  },
});
