import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ensureDir } from './jsonl.js';
import { nowIso, slugify, today, uniqueId } from './ids.js';
import type { Note } from './types.js';

/**
 * Notes are plain markdown files with YAML frontmatter, exactly like an
 * Obsidian vault. Nothing here is required to read them — that is the point.
 */

const FRONTMATTER_ORDER = [
  'id', 'title', 'date', 'type', 'companyId', 'dealId', 'attendees', 'tags', 'createdAt', 'updatedAt',
];

export interface NoteInput {
  title: string;
  body?: string;
  date?: string;
  type?: string;
  companyId?: string;
  dealId?: string;
  attendees?: string[];
  tags?: string[];
  [key: string]: unknown;
}

function noteFile(notesDir: string, id: string): string {
  return join(notesDir, `${id}.md`);
}

export function listNoteIds(notesDir: string): string[] {
  if (!existsSync(notesDir)) return [];
  return readdirSync(notesDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .map((f) => f.slice(0, -3))
    .sort()
    .reverse();
}

export function readNote(notesDir: string, id: string, includeBody = true): Note | null {
  const file = noteFile(notesDir, id);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const stats = statSync(file);
  const note: Note = {
    ...fm,
    id,
    title: String(fm.title ?? id),
    date: String(fm.date ?? id.slice(0, 10)),
    createdAt: String(fm.createdAt ?? stats.birthtime.toISOString()),
    updatedAt: String(fm.updatedAt ?? stats.mtime.toISOString()),
    path: join('notes', `${id}.md`),
  };
  if (includeBody) note.body = parsed.content.replace(/^\n+/, '');
  return note;
}

export function listNotes(notesDir: string, includeBody = false): Note[] {
  return listNoteIds(notesDir)
    .map((id) => readNote(notesDir, id, includeBody))
    .filter((n): n is Note => n !== null)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}

function serialise(note: Note, body: string): string {
  const fm: Record<string, unknown> = {};
  for (const key of FRONTMATTER_ORDER) {
    const value = (note as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
      fm[key] = value;
    }
  }
  for (const [key, value] of Object.entries(note)) {
    if (key === 'body' || key === 'path' || key in fm || FRONTMATTER_ORDER.includes(key)) continue;
    if (value !== undefined) fm[key] = value;
  }
  const trimmed = body.trim();
  const heading = trimmed.startsWith('#') ? '' : `# ${note.title}\n\n`;
  return matter.stringify(`\n${heading}${trimmed}\n`, fm);
}

export function createNote(notesDir: string, input: NoteInput): Note {
  ensureDir(notesDir);
  const date = input.date || today();
  const base = `${date}-${slugify(input.title)}`;
  const id = uniqueId(base, listNoteIds(notesDir));
  const ts = nowIso();
  const { body, ...rest } = input;
  const note: Note = {
    ...rest,
    id,
    title: input.title,
    date,
    createdAt: ts,
    updatedAt: ts,
    path: join('notes', `${id}.md`),
  };
  writeFileSync(noteFile(notesDir, id), serialise(note, body ?? ''), 'utf8');
  return { ...note, body: body ?? '' };
}

export function updateNote(notesDir: string, id: string, patch: Partial<NoteInput>): Note | null {
  const existing = readNote(notesDir, id, true);
  if (!existing) return null;
  const { body, ...rest } = patch;
  const next: Note = { ...existing, ...rest, id, updatedAt: nowIso() };
  const nextBody = body !== undefined ? body : (existing.body ?? '');
  writeFileSync(noteFile(notesDir, id), serialise(next, nextBody), 'utf8');
  return { ...next, body: nextBody };
}

/** Appends markdown to the end of a note — the cheapest way for an agent to log. */
export function appendNote(notesDir: string, id: string, markdown: string): Note | null {
  const existing = readNote(notesDir, id, true);
  if (!existing) return null;
  const body = `${(existing.body ?? '').trimEnd()}\n\n${markdown.trim()}\n`;
  return updateNote(notesDir, id, { body });
}

export function deleteNote(notesDir: string, id: string): boolean {
  const file = noteFile(notesDir, id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** Full-text search over frontmatter and body. */
export function searchNotes(notesDir: string, query: string): Note[] {
  const q = query.toLowerCase();
  return listNotes(notesDir, true).filter((n) => {
    const hay = `${n.title} ${n.tags?.join(' ') ?? ''} ${n.companyId ?? ''} ${n.attendees?.join(' ') ?? ''} ${n.body ?? ''}`;
    return hay.toLowerCase().includes(q);
  });
}

export function notePath(notesDir: string, id: string): string {
  return noteFile(notesDir, id);
}
