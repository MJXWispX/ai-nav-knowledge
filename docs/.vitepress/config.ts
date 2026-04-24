import { defineConfig } from 'vitepress'

export default defineConfig({
  // 站点基础信息
  title: '我的个人知识库',
  description: '记录技术学习、项目经验与知识沉淀',
  lang: 'zh-CN',

  // 部署路径（如果用 GitHub Pages，设为仓库名；Vercel/Cloudflare Pages 可设为 '/'）
  base: '/my-knowledge-base/',

  // 主题配置
  themeConfig: {
    // 站点 logo（可选，放在 docs/public 目录下）
    logo: '/logo.png',

    // 顶部导航栏
    nav: [
      { text: '首页', link: '/' },
      { text: '技术笔记', link: '/tech/' },
      { text: '项目实战', link: '/project/' },
      { text: '关于我', link: '/about' }
    ],

    // 侧边栏（知识库核心，按目录层级配置）
    sidebar: {
      '/tech/': [
        {
          text: '前端开发',
          items: [
            { text: 'Vue 3 核心概念', link: '/tech/vue3-core' },
            { text: 'TypeScript 入门', link: '/tech/typescript-basics' }
          ]
        },
        {
          text: '后端开发',
          items: [
            { text: 'Node.js 异步编程', link: '/tech/nodejs-async' }
          ]
        }
      ],
      '/project/': [
        {
          text: '个人项目',
          items: [
            { text: 'VitePress 知识库搭建', link: '/project/vitepress-knowledge-base' }
          ]
        }
      ]
    },

    // 社交链接（可选）
    socialLinks: [
      { icon: 'github', link: 'https://github.com/你的用户名' }
    ],

    // 底部版权信息
    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2026 你的名字'
    }
  }
})