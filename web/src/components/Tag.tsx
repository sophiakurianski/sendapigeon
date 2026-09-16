import type { CSSProperties } from 'react';

interface TagPillProps {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}

const tagStyle = (tag: string) => {
  let hash = 2166136261;
  for (const character of tag.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const value = hash >>> 0;
  const hue = value % 360;
  const saturation = 27 + ((value >>> 8) % 10);
  return {
    '--tag-bg': `hsl(${hue} ${saturation}% 93%)`,
    '--tag-border': `hsl(${hue} ${saturation}% 76%)`,
    '--tag-ink': `hsl(${hue} ${Math.min(saturation + 7, 44)}% 32%)`,
  } as CSSProperties;
};

const labelFor = (tag: string) => tag.startsWith('#') ? tag : `#${tag}`;

export function TagPill({ tag, active = false, onClick }: TagPillProps) {
  const className = `tag${onClick ? ' tag-button' : ''}${active ? ' is-active' : ''}`;
  const style = tagStyle(tag);
  if (onClick) {
    return (
      <button type="button" className={className} style={style} aria-pressed={active} onClick={() => onClick(tag)}>
        {labelFor(tag)}
      </button>
    );
  }
  return <span className={className} style={style}>{labelFor(tag)}</span>;
}

export function TagList({ tags, max = 3, className = '' }: { tags?: string[]; max?: number; className?: string }) {
  if (!tags?.length) return null;
  const visible = tags.slice(0, max);
  return (
    <span className={`tag-list${className ? ` ${className}` : ''}`} aria-label={`Tags: ${tags.join(', ')}`}>
      {visible.map((tag) => <TagPill tag={tag} key={tag} />)}
      {tags.length > visible.length && <span className="tag-more">+{tags.length - visible.length}</span>}
    </span>
  );
}

type TagFilterProps = { tags: string[] } & (
  | { value: string; onChange: (tag: string) => void; multiple?: false }
  | { value: string[]; onChange: (tags: string[]) => void; multiple: true }
);

export function TagFilter(props: TagFilterProps) {
  const { tags, value } = props;
  if (!tags.length) return null;
  const selected = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (tag: string) => {
    if (props.multiple) {
      props.onChange(selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag]);
    } else {
      props.onChange(value === tag ? '' : tag);
    }
  };

  return (
    <div className="tag-filter-strip" aria-label={props.multiple ? 'Filter by one or more tags' : 'Filter by tag'}>
      <span className="tag-filter-label">
        Tags
        {props.multiple && selected.length > 0 && <small>{selected.length} selected · match any</small>}
      </span>
      <button
        type="button"
        className={`tag-filter-all${selected.length ? '' : ' is-active'}`}
        aria-pressed={!selected.length}
        onClick={() => props.multiple ? props.onChange([]) : props.onChange('')}
      >
        All
      </button>
      {tags.map((tag) => (
        <TagPill
          tag={tag}
          key={tag}
          active={selected.includes(tag)}
          onClick={toggle}
        />
      ))}
    </div>
  );
}
