export function money(value: number | undefined, currency = 'AUD'): string {
  if (value === undefined || value === null) return '—';
  return `${currency} ${value.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

/** Local calendar date, not the UTC one — see toLocalDate in src/core/ids.ts. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function today(): string {
  return localDate(new Date());
}

export function dueClass(due?: string, done?: boolean): string {
  if (!due || done) return 'due-date';
  if (due < today()) return 'due-date overdue';
  if (due === today()) return 'due-date today';
  return 'due-date';
}

/** "in 3 days", "2 days ago", "today" — for dates the reader scans, not sorts. */
export function relativeDay(date?: string): string {
  if (!date) return '';
  const days = Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** "7 Sep" — a date to glance at, not to sort by. */
export function shortDate(date?: string): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A deliberately small markdown renderer: headings, lists, emphasis, code,
 * links and rules. Notes are meeting notes, not documents.
 */
export function markdown(src: string): string {
  const inline = (text: string) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);

    if (task) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      const checked = task[1].toLowerCase() === 'x';
      out.push(`<li>${checked ? '☑' : '☐'} ${inline(task[2])}</li>`);
    } else if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (numbered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      out.push('<hr />');
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}
