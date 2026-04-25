import { defineConfig } from 'vitepress'
import { navbar } from './scripts/navbar'
import { createKnowledgeSidebar } from './scripts/sidebar'

// 站点元信息
const SITE_URL = 'https://ai-nav-knowledge.pages.dev'
const SITE_TITLE = 'WispX 的 AI 知识库'
const SITE_DESC = 'WispX 的 AI 知识库'

// 导航数据
const sidebar = createKnowledgeSidebar()

export default defineConfig({
  // 基础配置
  title: SITE_TITLE,
  description: SITE_DESC,
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  
  // 构建与源码
  outDir: './docs/.vitepress/dist',
  srcExclude: ['CLAUDE.md', 'README.md', 'node_modules/**'],

  // 头部与 SEO
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'viewport', content: 'width=device-width,initial-scale=1.0' }]
  ],

  // Markdown 配置
  markdown: {
    lineNumbers: true,
    image: { lazyLoading: true },
    config(md) {
      const defaultImageRender =
        md.renderer.rules.image ??
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))

      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const src = token.attrGet('src') ?? ''
        const isExternalImage = /^https?:\/\//i.test(src)

        // External image hosts may reject hotlink requests with Referer.
        // Add no-referrer policy globally to improve compatibility.
        if (isExternalImage) {
          token.attrSet('referrerpolicy', 'no-referrer')
          token.attrSet('crossorigin', 'anonymous')
        }

        return defaultImageRender(tokens, idx, options, env, self)
      }
    }
  },

  // 主题配置
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: SITE_TITLE,
    nav: navbar,
    sidebar,
    
    // 右侧大纲
    outline: { level: [2, 6], label: '大纲' },
    lastUpdated: { text: '更新时间' },

    // GitHub 链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/MJXWispX/ai-nav-knowledge' }
    ],
    editLink: {
      pattern: 'https://github.com/MJXWispX/ai-nav-knowledge/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    // 搜索功能
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索'
          },
          modal: {
            displayDetails: '显示详情',
            resetButtonTitle: '清空搜索',
            noResultsText: '无搜索结果',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    // 分页文字
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '主题切换',
    returnToTopLabel: '回到顶部'
  }
})