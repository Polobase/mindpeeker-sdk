import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Bun only auto-loads .env from the directory the command is launched in, so
 * running `bun test` inside packages/entropy would miss the workspace-root
 * .env. Walk up from the given directory and load the nearest one;
 * explicitly exported variables always win over file values.
 */
export function loadNearestDotEnv(startDir: string): void {
  let dir = startDir
  for (let depth = 0; depth < 6; depth++) {
    const file = join(dir, '.env')
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match) continue
        const key = match[1] as string
        const value = (match[2] as string).replace(/^(['"])(.*)\1$/, '$2')
        if (value !== '' && process.env[key] === undefined) process.env[key] = value
      }
      return
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}
