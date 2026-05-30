import fs from 'node:fs'
import path from 'node:path'

const KNOWLEDGE_DIR = path.resolve('docs/knowledge')
const target = process.argv[2]

if (!target) {
  console.log('用法: npm run order -- <目录名>')
  console.log('示例: npm run order -- opencode')
  console.log('')
  console.log('可用的 knowledge 子目录:')
  const dirs = fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
  for (const d of dirs) {
    console.log(`  ${d.name}`)
  }
  process.exit(1)
}

const dirPath = path.resolve(KNOWLEDGE_DIR, target)
if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
  console.error(`错误: 目录不存在 — docs/knowledge/${target}`)
  process.exit(1)
}

// Collect md files (exclude index.md)
const mdFiles = fs.readdirSync(dirPath, { withFileTypes: true })
  .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
  .map(e => path.basename(e.name, '.md'))

const orderPath = path.join(dirPath, 'order.json')
let existing = []
if (fs.existsSync(orderPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
    if (Array.isArray(raw)) existing = raw
  } catch { /* ignore invalid existing file */ }
}

// Preserve existing order, append new files alphabetically at the end
const existingSet = new Set(existing)
const newFiles = mdFiles.filter(f => !existingSet.has(f)).sort((a, b) => a.localeCompare(b, 'zh-CN'))

// Remove files that no longer exist
const finalOrder = existing.filter(f => mdFiles.includes(f)).concat(newFiles)

fs.writeFileSync(orderPath, JSON.stringify(finalOrder, null, 2) + '\n', 'utf-8')

console.log(`✅ 已生成 docs/knowledge/${target}/order.json:`)
finalOrder.forEach((name, i) => console.log(`  ${i + 1}. ${name}`))
