/**
 * Parses data/keywords-source.md (XMind outline export)
 * into public/keywords-space.json for the app.
 *
 * Usage: node scripts/parse-keywords.mjs
 * Or:    npm run parse-keywords
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'data', 'keywords-source.md')
const outPath = path.join(root, 'public', 'keywords-space.json')

const LINE_RE = /^(\s*)(\d+)\.\s+(.+?)\s*$/

function cleanName(raw) {
  return raw
    .replace(/\s*\(category only\)\s*/gi, '')
    .replace(/\s*\(not a keyword\)\s*/gi, '')
    .trim()
}

function isExcluded(raw) {
  const lower = raw.toLowerCase()
  return (
    lower.includes('(category only)') ||
    lower.includes('(not a keyword)')
  )
}

function parseMarkdown(text) {
  const lines = text.split(/\r?\n/)
  const entries = []

  for (const line of lines) {
    const m = line.match(LINE_RE)
    if (!m) continue
    const indent = m[1].length
    const nameRaw = m[3]
    entries.push({ indent, nameRaw })
  }

  const indents = [...new Set(entries.map((e) => e.indent))].sort((a, b) => a - b)
  const depthOf = Object.fromEntries(indents.map((n, i) => [n, i]))

  /** @type {Array<{ id: string, name: string, categoryOnly: boolean, path: string[], children: any[] }>} */
  const roots = []
  /** @type {Array<{ depth: number, node: any }>} */
  const stack = []

  let counter = 0

  for (const { indent, nameRaw } of entries) {
    const depth = depthOf[indent]
    const name = cleanName(nameRaw)
    if (!name) continue

    const categoryOnly = isExcluded(nameRaw)
    while (stack.length && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }

    const parentPath = stack.map((s) => s.node.name)
    const pathNames = [...parentPath, name]
    const id = `kw-${++counter}`

    const node = {
      id,
      name,
      categoryOnly,
      path: pathNames,
      children: [],
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ depth, node })
  }

  return roots
}

/** Flatten selectable keywords (not category-only / not-a-keyword). */
function flattenKeywords(roots) {
  /** @type {Array<{ id: string, name: string, category: string, path: string[], pathLabel: string, searchable: string }>} */
  const leaves = []

  function walk(node, topCategory) {
    const category = topCategory || node.name
    if (!node.categoryOnly) {
      const pathWithoutRoot = node.path.slice(1)
      leaves.push({
        id: node.id,
        name: node.name,
        category,
        path: node.path,
        pathLabel: pathWithoutRoot.join(' > ') || node.name,
        searchable: [...node.path, node.name].join(' ').toLowerCase(),
      })
    }
    for (const child of node.children) {
      walk(child, category)
    }
  }

  for (const root of roots) {
    walk(root, root.name)
  }

  return leaves
}

function main() {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing source: ${sourcePath}`)
    process.exit(1)
  }

  const text = fs.readFileSync(sourcePath, 'utf8')
  const tree = parseMarkdown(text)
  const keywords = flattenKeywords(tree)

  const payload = {
    version: 1,
    source: 'XMind Keywords Space (pxg34i)',
    generatedAt: new Date().toISOString(),
    categories: tree.map((t) => t.name),
    tree,
    keywords,
    stats: {
      roots: tree.length,
      selectableKeywords: keywords.length,
    },
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log(
    `Wrote ${outPath} — ${payload.stats.selectableKeywords} keywords across ${payload.stats.roots} top categories`,
  )
}

main()
