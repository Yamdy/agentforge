import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentForge',
  description: 'Production-ready Agent framework based on RxJS event stream + Zod type safety',
  lang: 'zh-CN',
  ignoreDeadLinks: true,  // 忽略死链接
  
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
          items: [
            { text: '简介', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '核心概念', link: '/guide/core-concepts' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '概览', link: '/api/' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '设计文档',
          items: [
            { text: '架构概览', link: '/architecture/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/agentforge' },
    ],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024 AgentForge',
    },
  },
});