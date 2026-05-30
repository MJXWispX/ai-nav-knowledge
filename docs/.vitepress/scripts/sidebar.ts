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

function readTitle(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
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

function readDirOrder(dirPath: string): Map<string, number> {
  const orderFile = path.join(dirPath, 'order.json')
  if (!fs.existsSync(orderFile)) return new Map()
  try {
    const data = JSON.parse(fs.readFileSync(orderFile, 'utf-8'))
    if (!Array.isArray(data)) return new Map()
    const orderMap = new Map<string, number>()
    data.forEach((name: string, index: number) => orderMap.set(name, index))
    return orderMap
  } catch {
    return new Map()
  }
}

function sortWithOrder(
  items: Array<{ text: string; link: string }>,
  orderMap: Map<string, number>
): void {
  items.sort((a, b) => {
    const aName = path.basename(a.link)
    const bName = path.basename(b.link)
    const aOrder = orderMap.get(aName)
    const bOrder = orderMap.get(bName)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a.link.localeCompare(b.link, 'zh-CN')
  })
}

function buildGroupMap(
  items: SidebarLeafItem[],
  knowledgeRootDir: string
): Map<string, Array<{ text: string; link: string }>> {
  const groupMap = new Map<string, Array<{ text: string; link: string }>>()

  for (const item of items) {
    const groupName = getGroupName(item.relativePath)
    if (!groupMap.has(groupName)) groupMap.set(groupName, [])
    groupMap.get(groupName)?.push({ text: item.text, link: item.link })
  }

  for (const [groupName, groupItems] of groupMap) {
    const dirPath = groupName === ROOT_GROUP
      ? knowledgeRootDir
      : path.join(knowledgeRootDir, groupName)
    const orderMap = readDirOrder(dirPath)
    if (orderMap.size > 0) {
      sortWithOrder(groupItems, orderMap)
    } else {
      sortByLink(groupItems)
    }
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

  const groupMap = buildGroupMap(items, knowledgeRootDir)
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
