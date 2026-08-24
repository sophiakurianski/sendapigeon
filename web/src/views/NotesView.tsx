import { useEffect, useState } from 'react';
import { api, type Company, type Note } from '../api';
import { Empty } from '../components/Drawer';
import { PigeonWaiting } from '../components/Pigeon';
import { shortDate } from '../lib';
import type { ViewProps } from './types';

export function NotesView({ onSelect, notify, version }: ViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [companies, setCompanies] = useState<Record<string, Company>>({});

  useEffect(() => {
    Promise.all([api.notes(), api.companies()])
      .then(([list, cos]) => {
        setNotes(list);
        setCompanies(Object.fromEntries(cos.map((c) => [c.id, c])));
      })
      .catch((e) => notify(e.message, true));
  }, [version, notify]);

  if (!notes.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="No notes in the vault">
        Notes are markdown files you can open in any editor. Write one with{' '}
        <code>pigeon note new "Acme kickoff" --deal acme-renewal</code>
      </Empty>
    );
  }

  return (
    <div className="rows">
      {notes.map((note) => (
        <button className="row" key={note.id} onClick={() => onSelect({ kind: 'note', id: note.id })}>
          <span className="row-main">
            <span className="row-title">{note.title}</span>
            <span className="row-sub">
              {[note.type, note.companyId ? companies[note.companyId]?.name ?? note.companyId : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="row-date">{shortDate(note.date)}</span>
        </button>
      ))}
    </div>
  );
}
