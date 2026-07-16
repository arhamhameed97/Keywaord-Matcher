/**
 * Vite/Rollup can fail when the absolute path contains an apostrophe
 * (e.g. folder names like Sara's Shit). Build from a temp copy, then
 * copy dist/ back into the project.
 *
 * Usage: npm run build:clean
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const tmp = path.join(os.tmpdir(), 'simplytv-keyword-helper-build')

function copyDir(src, dest, { skip = [] } = {}) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    if (skip.includes(name)) continue
    const from = path.join(src, name)
    const to = path.join(dest, name)
    const stat = fs.statSync(from)
    if (stat.isDirectory()) copyDir(from, to, { skip })
    else fs.copyFileSync(from, to)
  }
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: tmp,
    shell: true,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('Building from temp copy (avoids apostrophe-in-path Vite bug)…')
rimraf(tmp)
copyDir(root, tmp, { skip: ['node_modules', 'dist', '.git'] })

run('npm', ['install'])
run('node', ['scripts/parse-keywords.mjs'])
run('npx', ['tsc', '--noEmit'])
run('npx', ['vite', 'build'])

const distSrc = path.join(tmp, 'dist')
const distDest = path.join(root, 'dist')
rimraf(distDest)
copyDir(distSrc, distDest)
console.log(`Copied build output to ${distDest}`)
rimraf(tmp)
