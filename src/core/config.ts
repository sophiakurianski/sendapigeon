import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { readJson, writeJson, ensureDir } from './jsonl.js';
import { DEFAULT_CONFIG, type VaultConfig } from './types.js';

export const RC_FILE = join(homedir(), '.sendapigeonrc');
export const DEFAULT_VAULT = join(homedir(), 'SendAPigeon');

interface Rc {
  vault?: string;
}

/**
 * Resolution order: explicit argument, then $PIGEON_VAULT, then a
 * `.sendapigeon` folder found by walking up from the cwd, then ~/.sendapigeonrc,
 * then ~/SendAPigeon.
 */
export function resolveVault(explicit?: string): string {
  if (explicit) return resolve(expandHome(explicit));
  if (process.env.PIGEON_VAULT) return resolve(expandHome(process.env.PIGEON_VAULT));

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.sendapigeon');
    if (existsSync(join(candidate, 'pigeon.json'))) return candidate;
    if (existsSync(join(dir, 'pigeon.json')) && existsSync(join(dir, 'data'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  const rc = readJson<Rc>(RC_FILE, {});
  if (rc.vault) return resolve(expandHome(rc.vault));
  return DEFAULT_VAULT;
}

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

export function rememberVault(vault: string): void {
  writeJson(RC_FILE, { vault });
}

export function vaultPaths(vault: string) {
  return {
    root: vault,
    config: join(vault, 'pigeon.json'),
    data: join(vault, 'data'),
    companies: join(vault, 'data', 'companies.jsonl'),
    people: join(vault, 'data', 'people.jsonl'),
    deals: join(vault, 'data', 'deals.jsonl'),
    todos: join(vault, 'data', 'todos.jsonl'),
    activity: join(vault, 'data', 'activity.jsonl'),
    notes: join(vault, 'notes'),
    attachments: join(vault, 'attachments'),
  };
}

export function isVault(vault: string): boolean {
  return existsSync(vaultPaths(vault).config);
}

export function loadConfig(vault: string): VaultConfig {
  const cfg = readJson<Partial<VaultConfig>>(vaultPaths(vault).config, {});
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    stages: cfg.stages?.length ? cfg.stages : DEFAULT_CONFIG.stages,
  };
}

export function saveConfig(vault: string, config: VaultConfig): void {
  ensureDir(vault);
  writeJson(vaultPaths(vault).config, config);
}
