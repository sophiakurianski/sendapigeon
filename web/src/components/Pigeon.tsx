/**
 * The flat cartoon pigeon, and the postmark.
 *
 * A real pigeon is grey-brown all over except the neck, which is iridescent
 * teal shading to violet. That patch is the only saturated colour in the whole
 * app, so the bird wears it and the accents borrow it.
 */

export function PigeonMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 64 52" role="img" aria-label="SendAPigeon">
      {/* tail */}
      <path d="M20 30 L2 34 L20 44 Z" fill="var(--wing)" />
      {/* body */}
      <path d="M44 14c7 5 8 17-1 23-8 6-21 5-26-1-5-7 1-16 11-20 7-3 12-4 16-2z" fill="var(--dove)" />
      {/* folded wing */}
      <path d="M32 22c8-2 15 1 16 6s-5 9-13 9-14-3-14-8 3-6 11-7z" fill="var(--wing)" />
      {/* head */}
      <circle cx="45" cy="13" r="10" fill="var(--dove)" />
      {/* the iridescent neck patch */}
      <path d="M37 18c1 5 5 8 10 8 2 0 4-1 5-2-1 5-6 7-11 6-4-1-6-6-4-12z" fill="var(--teal)" />
      {/* beak */}
      <path d="M54 11 L64 14 L54 17 Z" fill="var(--stamp)" />
      {/* eye */}
      <circle cx="48" cy="10" r="1.9" fill="var(--ink)" />
    </svg>
  );
}

/** A pigeon with nothing to carry — used on empty screens. */
export function PigeonWaiting({ size = 62 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 64 52" aria-hidden="true" style={{ opacity: 0.75 }}>
      <path d="M20 30 L2 34 L20 44 Z" fill="var(--dove)" />
      <path d="M44 14c7 5 8 17-1 23-8 6-21 5-26-1-5-7 1-16 11-20 7-3 12-4 16-2z" fill="var(--sunk)" />
      <path d="M32 22c8-2 15 1 16 6s-5 9-13 9-14-3-14-8 3-6 11-7z" fill="var(--dove)" />
      <circle cx="45" cy="13" r="10" fill="var(--sunk)" />
      <path d="M37 18c1 5 5 8 10 8 2 0 4-1 5-2-1 5-6 7-11 6-4-1-6-6-4-12z" fill="var(--dove)" />
      <path d="M54 11 L64 14 L54 17 Z" fill="var(--wing)" />
      <circle cx="48" cy="10" r="1.9" fill="var(--wing)" />
    </svg>
  );
}

export function daysSince(iso?: string): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * The postmark: when this deal landed in its current stage, and how long it has
 * sat there. Fresh mail is faint; mail that has been sitting gets a heavier
 * stamp, so a stale pipeline is visible before you read a single word.
 */
export function Postmark({ since, days, size = 42 }: { since?: string; days: number; size?: number }) {
  const ink = days >= 21 ? 'var(--stamp)' : days >= 7 ? 'var(--teal)' : 'var(--dove)';
  const weight = days >= 21 ? 0.9 : days >= 7 ? 0.7 : 0.45;
  const arcId = `arc-${days}-${size}-${(since ?? '').slice(0, 10)}`;

  return (
    <svg
      className="postmark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ opacity: weight, transform: 'rotate(-8deg)' }}
      role="img"
      aria-label={`Landed here ${stampDate(since)}, ${days} ${days === 1 ? 'day' : 'days'} ago`}
    >
      <defs>
        <path id={arcId} d="M50 50 m -40 0 a 40 40 0 1 1 80 0" fill="none" />
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke={ink} strokeWidth="2.5" />
      <circle cx="50" cy="50" r="34" fill="none" stroke={ink} strokeWidth="1.2" />
      <text fontSize="10" fontFamily="var(--font-mono)" letterSpacing="1.4" fill={ink} textAnchor="middle">
        <textPath href={`#${arcId}`} startOffset="50%">
          {stampDate(since)}
        </textPath>
      </text>
      <text x="50" y="53" fontSize="26" fontFamily="var(--font-mono)" fontWeight="600" fill={ink} textAnchor="middle">
        {days}
      </text>
      <text x="50" y="67" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="1.2" fill={ink} textAnchor="middle">
        {days === 1 ? 'DAY' : 'DAYS'}
      </text>
    </svg>
  );
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Postmark date format: "14 AUG". */
function stampDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * A plumage disc bearing someone's initials. The tone is derived from their id
 * so it never changes between reloads — with seventy contacts on screen, a
 * stable colour is what lets you find someone again by memory.
 */
export function Monogram({
  name,
  id,
  size = 'md',
}: {
  name: string;
  id: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="monogram" data-size={size} data-tone={toneFor(id)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  // Drop parenthetical and punctuation-only fragments — "Ammunition (SF)" should
  // read AM, not "A(", and "Phoenix Day / SJSU" should read PS, not "P/".
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s/,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Cheap stable hash → one of five plumage tones. */
function toneFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 5;
}
