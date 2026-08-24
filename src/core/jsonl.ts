import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal JSONL persistence. One record per line, appended on create and
 * rewritten atomically on update/delete so a crash never leaves a half file.
 */

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  const out: T[] = [];
  let lineNo = 0;
  for (const line of raw.split('\n')) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      throw new Error(`Malformed JSON in ${file} at line ${lineNo}: ${trimmed.slice(0, 120)}`);
    }
  }
  return out;
}

export function appendJsonl(file: string, record: unknown): void {
  ensureDir(dirname(file));
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

export function writeJsonl(file: string, records: unknown[]): void {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(tmp, records.length ? body + '\n' : '', 'utf8');
  renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
