/** Slug-based ids: readable in the file, in a URL and in an agent transcript. */

export function slugify(input: string, maxLength = 48): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

/** Returns `base`, or `base-2`, `base-3`… until it does not collide. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * YYYY-MM-DD in the machine's own timezone. Deliberately not
 * `toISOString().slice(0, 10)` — east of UTC that reports yesterday for most of
 * the working day, which files notes under the wrong date and flips todos to
 * overdue early.
 */
export function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function today(): string {
  return toLocalDate(new Date());
}

/**
 * Accepts ISO dates, `today`, `tomorrow`, `friday`, `+3d`, `+2w`, `next week`.
 * Returns YYYY-MM-DD, or null when it cannot tell.
 */
export function parseDate(input?: string | null): string | null {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const shift = (days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return toLocalDate(d);
  };

  if (raw === 'today') return shift(0);
  if (raw === 'tomorrow') return shift(1);
  if (raw === 'yesterday') return shift(-1);
  if (raw === 'next week') return shift(7);
  if (raw === 'next month') return shift(30);

  const rel = raw.match(/^\+(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0];
    return shift(unit === 'd' ? n : unit === 'w' ? n * 7 : n * 30);
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = days.indexOf(raw.replace(/^next\s+/, ''));
  if (dayIdx >= 0) {
    const delta = ((dayIdx - base.getDay() + 7) % 7) || 7;
    return shift(delta);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return toLocalDate(parsed);
  return null;
}
