import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Note, type Person } from '../api';
import { Empty } from '../components/Drawer';
import { PigeonWaiting } from '../components/Pigeon';
import { TagFilter, TagList } from '../components/Tag';
import { shortDate } from '../lib';
import type { ViewProps } from './types';

type GroupMode = 'person' | 'company';
type NoteGroup = { id: string; name: string; notes: Note[]; selection?: { kind: 'person' | 'company'; id: string } };

export function NotesView({ onSelect, notify, version }: ViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [mode, setMode] = useState<GroupMode>('person');
  const [tag, setTag] = useState('');

  useEffect(() => {
    Promise.all([api.notes(), api.companies(), api.people()])
      .then(([list, cos, contacts]) => {
        setNotes(list);
        setCompanies(Object.fromEntries(cos.map((company) => [company.id, company])));
        setPeople(Object.fromEntries(contacts.map((person) => [person.id, person])));
      })
      .catch((error) => notify(error.message, true));
  }, [version, notify]);

  const tags = useMemo(
    () => Array.from(new Set(notes.flatMap((note) => note.tags ?? []))).sort((a, b) => a.localeCompare(b)),
    [notes],
  );

  const visibleNotes = useMemo(
    () => tag ? notes.filter((note) => note.tags?.includes(tag)) : notes,
    [notes, tag],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, Note[]>();
    for (const note of visibleNotes) {
      const ids = mode === 'person'
        ? [...new Set(note.attendees ?? [])]
        : [...new Set([
            ...(note.companyId ? [note.companyId] : []),
            ...(note.attendees ?? []).map((id) => people[id]?.companyId).filter((id): id is string => Boolean(id)),
          ])];
      for (const id of ids.length ? ids : ['']) grouped.set(id, [...(grouped.get(id) ?? []), note]);
    }

    return [...grouped.entries()]
      .map(([id, items]): NoteGroup => ({
        id,
        name: mode === 'person' ? people[id]?.name ?? 'No person linked' : companies[id]?.name ?? 'No company linked',
        notes: [...items].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),
        selection: id ? { kind: mode, id } : undefined,
      }))
      .sort((a, b) => {
        if (!a.id) return 1;
        if (!b.id) return -1;
        return a.name.localeCompare(b.name);
      });
  }, [visibleNotes, people, companies, mode]);

  if (!notes.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="No notes in the vault">
        Notes are markdown files you can open in any editor. Write one with{' '}
        <code>pigeon note new "Acme kickoff" --deal acme-renewal</code>
      </Empty>
    );
  }

  return (
    <>
      <div className="notes-controls">
        <div className="segmented" role="group" aria-label="Organise meeting notes">
          <button aria-pressed={mode === 'person'} onClick={() => setMode('person')}>By person</button>
          <button aria-pressed={mode === 'company'} onClick={() => setMode('company')}>By company</button>
        </div>
        <span>
          {tag ? `${visibleNotes.length} of ${notes.length}` : notes.length} {notes.length === 1 ? 'meeting note' : 'meeting notes'}
        </span>
      </div>

      <TagFilter tags={tags} value={tag} onChange={setTag} />

      {!visibleNotes.length ? (
        <Empty icon={<PigeonWaiting size={50} />} title={`No notes tagged #${tag}`}>
          Choose another tag or select All to see every meeting note.
        </Empty>
      ) : <div className="note-groups">
        {groups.map((group) => (
          <section className="note-group" key={`${mode}-${group.id || 'unlinked'}`}>
            <header className="note-group-head">
              {group.selection ? <button onClick={() => onSelect(group.selection!)}>{group.name}</button> : <span>{group.name}</span>}
              <small>{group.notes.length} {group.notes.length === 1 ? 'note' : 'notes'}</small>
            </header>
            <div className="rows note-group-rows">
              {group.notes.map((note) => {
                const attendeeNames = (note.attendees ?? []).map((id) => people[id]?.name ?? id);
                const context = mode === 'person'
                  ? [note.type, note.companyId ? companies[note.companyId]?.name ?? note.companyId : null]
                  : [note.type, attendeeNames.length ? attendeeNames.join(', ') : null];
                return (
                  <button className="row" key={note.id} onClick={() => onSelect({ kind: 'note', id: note.id })}>
                    <span className="row-main">
                      <span className="row-title">{note.title}</span>
                      <span className="row-sub">{context.filter(Boolean).join(' · ')}</span>
                      <TagList tags={note.tags} className="note-tag-list" />
                    </span>
                    <span className="row-date">{shortDate(note.date)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>}
    </>
  );
}
