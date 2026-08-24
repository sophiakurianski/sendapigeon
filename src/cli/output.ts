/** Terminal output helpers. Pigeon palette: warm browns, beiges, slate. */

const ESC = '\x1b[';
const enabled = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: string) => (s: string) => (enabled ? `${ESC}${code}m${s}${ESC}0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  brown: wrap('38;5;137'),
  beige: wrap('38;5;180'),
  cream: wrap('38;5;223'),
  slate: wrap('38;5;103'),
  green: wrap('38;5;108'),
  red: wrap('38;5;167'),
  amber: wrap('38;5;179'),
};

export const PIGEON = [
  `   ${c.slate('__')}`,
  `  ${c.slate('(')}${c.cream('o')}${c.slate(' >')}   ${c.bold(c.brown('SendAPigeon'))}`,
  `  ${c.beige('/)_)')}   ${c.dim('agent-first CRM')}`,
  `   ${c.beige('"')}`,
].join('\n');

export function money(value: number | undefined, currency = 'AUD'): string {
  if (value === undefined || value === null) return '';
  return `${currency} ${value.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  width?: number;
}

const ANSI_RE = new RegExp('\\x1b\\[[0-9;]*m', 'g');

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function pad(s: string, width: number): string {
  const gap = width - visibleLength(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function clip(s: string, width: number): string {
  if (visibleLength(s) <= width) return s;
  const plain = s.replace(ANSI_RE, '');
  return plain.slice(0, Math.max(0, width - 1)) + '…';
}

export function table<T>(rows: T[], columns: Column<T>[]): string {
  if (!rows.length) return c.dim('  (nothing here yet)');
  const cells = rows.map((r) => columns.map((col) => col.get(r) ?? ''));
  const widths = columns.map((col, i) =>
    Math.min(col.width ?? 60, Math.max(visibleLength(col.header), ...cells.map((row) => visibleLength(row[i])))),
  );
  const head = '  ' + columns.map((col, i) => c.dim(pad(col.header.toUpperCase(), widths[i]))).join('  ');
  const body = cells.map(
    (row) => '  ' + row.map((cell, i) => pad(clip(cell, widths[i]), widths[i])).join('  ').trimEnd(),
  );
  return [head, ...body].join('\n');
}

export function heading(text: string): string {
  return `\n${c.bold(c.brown(text))}`;
}

export function keyValues(pairs: [string, unknown][]): string {
  const shown = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  if (!shown.length) return '';
  const width = Math.max(...shown.map(([k]) => k.length));
  return shown
    .map(([k, v]) => `  ${c.dim(pad(k, width))}  ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('\n');
}

export function print(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : value + '\n');
}

export function json(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function fail(message: string, asJson: boolean, code = 'ERROR'): never {
  if (asJson) process.stdout.write(JSON.stringify({ ok: false, error: message, code }, null, 2) + '\n');
  else process.stderr.write(`${c.red('✗')} ${message}\n`);
  process.exit(1);
}

export function ok(message: string): void {
  process.stdout.write(`${c.green('✓')} ${message}\n`);
}
