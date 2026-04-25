import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme } from 'vitepress'

const ROOT_GROUP = '__root__'
const KNOWLEDGE_ROUTE_PREFIX = '/knowledge/'
const KNOWLEDGE_DOCS_DIR = ['docs', 'knowledge']

type SidebarLeafItem = { text: string; link: string; relativePath: string }

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function isMarkdownDoc(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  return lowerName.endsWith('.md') && lowerName !== 'index.md'
}

function isHiddenDir(name: string): boolean {
  return name.startsWith('.')
}

function collectMarkdownFiles(
  dir: string,
  visited = new Set<string>()
): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) return files
  if (!fs.statSync(dir).isDirectory()) return files

  const realDirPath = fs.realpathSync(dir)
  if (visited.has(realDirPath)) return files
  visited.add(realDirPath)

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (isHiddenDir(entry.name)) continue
      files.push(...collectMarkdownFiles(fullPath, visited))
      continue
    }

    if (entry.isFile() && isMarkdownDoc(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

function formatFallbackText(filePath: string): string {
  const baseName = path.basename(filePath, path.extname(filePath))
  return baseName
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

function readTitle(filePath: string): string {
  const fallbackTitle = formatFallbackText(filePath)
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    // Display name priority:
    // 1) first H1 within top lines
    // 2) fallback to file name
    const h1Line = lines
      .slice(0, 30)
      .find((line) => line.trim().startsWith('# '))

    if (!h1Line) return fallbackTitle
    const headingTitle = h1Line.replace(/^#\s+/, '').trim()
    // For overly generic short headings (e.g. "基础"), keep filename for better distinction.
    if (headingTitle.length <= 2 && fallbackTitle.length > headingTitle.length) return fallbackTitle
    return headingTitle
  } catch {
    return fallbackTitle
  }
}

function toKnowledgeLink(filePath: string, knowledgeRootDir: string): string {
  const relative = toPosixPath(path.relative(knowledgeRootDir, filePath))
  return `${KNOWLEDGE_ROUTE_PREFIX}${relative.replace(/\.[^/.]+$/, '')}`
}

function getGroupName(relativePath: string): string {
  const parts = relativePath.split('/')
  return parts.length > 1 ? parts[0] : ROOT_GROUP
}

function sortByLink(items: Array<{ text: string; link: string }>): void {
  items.sort((a, b) => a.link.localeCompare(b.link, 'zh-CN'))
}

function buildGroupMap(items: SidebarLeafItem[]): Map<string, Array<{ text: string; link: string }>> {
  const groupMap = new Map<string, Array<{ text: string; link: string }>>()

  for (const item of items) {
    const groupName = getGroupName(item.relativePath)
    if (!groupMap.has(groupName)) groupMap.set(groupName, [])
    groupMap.get(groupName)?.push({ text: item.text, link: item.link })
  }

  for (const [, groupItems] of groupMap) {
    sortByLink(groupItems)
  }

  return groupMap
}

function prioritizeGettingStarted(rootItems: Array<{ text: string; link: string }>): Array<{ text: string; link: string }> {
  const nextItems = [...rootItems]
  const gettingStartedIndex = nextItems.findIndex((item) => item.link === '/knowledge/getting-started')
  if (gettingStartedIndex <= 0) return nextItems
  const [gettingStarted] = nextItems.splice(gettingStartedIndex, 1)
  nextItems.unshift(gettingStarted)
  return nextItems
}

function buildDirectorySections(
  groupMap: Map<string, Array<{ text: string; link: string }>>
): DefaultTheme.SidebarItem[] {
  return Array.from(groupMap.entries())
    .filter(([groupName]) => groupName !== ROOT_GROUP)
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
    .map(([groupName, groupItems]) => ({
      text: groupName,
      collapsed: true,
      items: groupItems
    }))
}

export function createKnowledgeSidebar(): DefaultTheme.Sidebar {
  const knowledgeRootDir = path.resolve(process.cwd(), ...KNOWLEDGE_DOCS_DIR)
  const markdownFiles = collectMarkdownFiles(knowledgeRootDir)

  const items: SidebarLeafItem[] = markdownFiles
    .map((filePath) => ({
      relativePath: toPosixPath(path.relative(knowledgeRootDir, filePath)),
      text: readTitle(filePath),
      link: toKnowledgeLink(filePath, knowledgeRootDir)
    }))
    .filter((item) => item.relativePath && !item.relativePath.startsWith('..'))
    .filter((item, index, all) => index === all.findIndex((candidate) => candidate.link === item.link))

  const groupMap = buildGroupMap(items)
  // Keep current UX:
  // - root files are flat list
  // - first-level directories are collapsible groups
  // - getting-started stays on top of root items
  const rootItems = prioritizeGettingStarted(groupMap.get(ROOT_GROUP) ?? [])
  const sidebarItems: DefaultTheme.SidebarItem[] = []
  sidebarItems.push(...rootItems)
  const directorySections = buildDirectorySections(groupMap)
  sidebarItems.push(...directorySections)

  return {
    [KNOWLEDGE_ROUTE_PREFIX]: [
      {
        text: 'AI 知识库',
        items: sidebarItems
      }
    ]
  }
}
