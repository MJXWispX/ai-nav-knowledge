# ai-nav-knowledge
基于 **VitePress + Vue 3 + Vite** 构建的纯静态文档站点，专注沉淀 AI 学习、开发与实践相关知识。

---

## ✨ 项目简介
这是一个轻量化、可离线部署的 AI 知识库，旨在系统化整理 AI 领域的学习笔记、工具推荐、实践教程与避坑指南，打造一个可沉淀、可分享、可扩展的个人知识平台。

- 🚀 **极速体验**：基于 VitePress 构建，热更新秒级响应，静态部署零依赖
- 📱 **响应式设计**：完美适配桌面、平板与手机，随时随地查阅知识
- 🔍 **内置搜索**：支持全文检索，快速定位你需要的内容
- 🌐 **一键部署**：支持 Cloudflare Pages / GitHub Pages 等平台，自动构建更新

---

## 🛠️ 本地开发
### 环境要求
- Node.js `>= 20`
- 包管理器：`pnpm` / `npm` / `yarn`（推荐 `pnpm`）

### 启动步骤
```bash
# 1. 克隆项目
git clone https://github.com/MJXWispX/ai-nav-knowledge.git
cd ai-nav-knowledge

# 2. 安装依赖
pnpm install

# 3. 启动本地开发服务（访问 http://localhost:5173）
pnpm docs:dev
```

### 常用命令
```bash
# 启动开发服务（支持热更新）
pnpm docs:dev

# 构建生产环境静态文件
pnpm docs:build

# 本地预览构建产物
pnpm docs:serve
```

---

## 🚀 部署说明
本项目推荐使用 **Cloudflare Pages** 一键部署，支持 `git push` 后自动构建更新：

1.  登录 Cloudflare 控制台 → `Workers & Pages` → `Create application` → `Pages`
2.  连接你的 GitHub 仓库 `MJXWispX/ai-nav-knowledge`
3.  配置构建参数：
    | 配置项 | 值 |
    |--------|----|
    | Framework preset | `None` |
    | Build command | `pnpm docs:build` |
    | Build output directory | `docs/.vitepress/dist` |
    | Root directory | `/` |
4.  保存配置，Cloudflare 会自动完成构建与部署，访问你的专属 `.pages.dev` 域名即可查看。

---

## 📂 项目结构
```text
ai-nav-knowledge/
├── docs/
│   ├── .vitepress/
│   │   ├── config.ts    # 站点核心配置
│   │   ├── theme/       # 自定义主题样式与组件
│   │   └── public/       # 静态资源（logo、图标等）
│   ├── index.md         # 站点首页
│   └── ...              # 其他文档页面
├── package.json         # 项目依赖与脚本配置
└── README.md            # 项目说明文档
```

---

## 📝 文档编写规范
- 文档使用 Markdown 格式编写，支持 VitePress 扩展语法
- 新文档请按主题分类放入 `docs` 目录下，保持目录结构清晰
- 如需自定义样式或组件，可在 `docs/.vitepress/theme/` 中扩展

---

## 📄 License
本项目基于 **MIT License** 开源，欢迎学习、参考与二次修改。

---

## 📬 联系作者
- GitHub: [MJXWispX](https://github.com/MJXWispX)
- 项目地址: [ai-nav-knowledge](https://github.com/MJXWispX/ai-nav-knowledge)

---

💡 如果你觉得这个项目对你有帮助，欢迎点个 ⭐ Star 支持一下！