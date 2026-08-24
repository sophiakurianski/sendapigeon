import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Person } from '../api';
import { Empty } from '../components/Drawer';
import { Monogram, PigeonWaiting } from '../components/Pigeon';
import type { ViewProps } from './types';

type Mode = 'studio' | 'az';

export function PeopleView({ onSelect, notify, version }: ViewProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [mode, setMode] = useState<Mode>('studio');

  useEffect(() => {
    Promise.all([api.people(), api.companies()])
      .then(([list, cos]) => {
        setPeople(list);
        setCompanies(Object.fromEntries(cos.map((c) => [c.id, c])));
      })
      .catch((e) => notify(e.message, true));
  }, [version, notify]);

  /** People grouped under their studio, biggest bench first, unattached last. */
  const studios = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const person of people) {
      const key = person.companyId ?? '';
      map.set(key, [...(map.get(key) ?? []), person]);
    }
    return [...map.entries()]
      .map(([id, members]) => ({
        id,
        company: companies[id],
        name: companies[id]?.name ?? 'No company yet',
        members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        if (!a.id) return 1;
        if (!b.id) return -1;
        return b.members.length - a.members.length || a.name.localeCompare(b.name);
      });
  }, [people, companies]);

  /* Same rule as the company cards: an industry shared by every company is
     noise repeated once per group, not information. */
  const uniformIndustry = useMemo(
    () => new Set(Object.values(companies).map((c) => c.industry ?? '')).size <= 1,
    [companies],
  );

  if (!people.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="No contacts yet">
        Contacts live under a company. Add one with{' '}
        <code>pigeon person add "Jane Doe" --company Acme --email jane@acme.com</code>
      </Empty>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Group contacts">
          <button aria-pressed={mode === 'studio'} onClick={() => setMode('studio')}>
            By company
          </button>
          <button aria-pressed={mode === 'az'} onClick={() => setMode('az')}>
            A–Z
          </button>
        </div>
      </div>

      {mode === 'az' ? (
        <div className="rows">
          {[...people]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((person) => (
              <button className="row" key={person.id} onClick={() => onSelect({ kind: 'person', id: person.id })}>
                <Monogram name={person.name} id={person.id} size="sm" />
                <span className="row-main">
                  <span className="row-title">{person.name}</span>
                  <span className="row-sub">
                    {[person.title, person.companyId ? companies[person.companyId]?.name : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {person.email && <span className="person-contact">{person.email}</span>}
              </button>
            ))}
        </div>
      ) : (
        <div className="roster">
          {studios.map((studio) => (
            <section className="studio" key={studio.id || 'none'}>
              <button
                className="studio-head"
                onClick={() => studio.company && onSelect({ kind: 'company', id: studio.id })}
                disabled={!studio.company}
              >
                <span>
                  <span className="studio-name">{studio.name}</span>
                  {(() => {
                    const meta = [
                      uniformIndustry ? null : studio.company?.industry,
                      studio.company?.domain ?? studio.company?.location,
                    ].filter(Boolean);
                    return meta.length ? <span className="studio-meta">{meta.join(' · ')}</span> : null;
                  })()}
                </span>
                <span className="studio-count">
                  {studio.members.length} {studio.members.length === 1 ? 'person' : 'people'}
                </span>
              </button>

              <div className="bench">
                {studio.members.map((person) => (
                  <button
                    className="person"
                    key={person.id}
                    onClick={() => onSelect({ kind: 'person', id: person.id })}
                  >
                    <Monogram name={person.name} id={person.id} size="sm" />
                    <span className="person-main">
                      <span className="person-name">{person.name}</span>
                      {person.title && <span className="person-role"> {person.title}</span>}
                    </span>
                    {person.email && <span className="person-contact">{person.email}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
