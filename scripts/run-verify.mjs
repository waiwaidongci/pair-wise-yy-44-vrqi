// 用 esbuild 把验证脚本打包到临时文件后运行，注入 node 环境桩
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const outfile = 'scripts/.verify-bundle.mjs'

class LocalStorageShim {
  constructor() {
    this.map = new Map()
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

globalThis.localStorage = new LocalStorageShim()

await build({
  entryPoints: ['scripts/verify-tour.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"test"',
  },
  logLevel: 'warning',
})

try {
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(outfile, { force: true })
}
