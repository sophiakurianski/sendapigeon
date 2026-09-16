import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Person } from '../api';
import { Empty } from '../components/Drawer';
import { Monogram, PigeonWaiting } from '../components/Pigeon';
import { TagFilter, TagList } from '../components/Tag';
import { relativeDay } from '../lib';
import type { ViewProps } from './types';

type Mode = 'studio' | 'az' | 'recent';
type Sort = 'name' | 'company' | 'location' | 'title' | 'created' | 'updated';
type Attribute = 'title' | 'company' | 'location' | 'email' | 'phone' | 'linkedin' | 'owner' | 'created';

const ATTRIBUTES: { id: Attribute; label: string }[] = [
  { id: 'title', label: 'Role' },
  { id: 'company', label: 'Company' },
  { id: 'location', label: 'Location' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'owner', label: 'Owner' },
  { id: 'created', label: 'Added' },
];

const valueFor = (person: Person, field: Attribute, companies: Record<string, Company>): string => {
  const company = person.companyId ? companies[person.companyId] : undefined;
  if (field === 'company') return company?.name ?? '';
  if (field === 'location') return person.location ?? company?.location ?? '';
  if (field === 'linkedin') return person.linkedin ? 'Profile saved' : '';
  if (field === 'created') return relativeDay(person.createdAt.slice(0, 10));
  return person[field] ?? '';
};

export function PeopleView({ onSelect, notify, refresh, version }: ViewProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [mode, setMode] = useState<Mode>('studio');
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [shown, setShown] = useState<Attribute[]>(['title', 'location']);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.people(), api.companies()])
      .then(([list, cos]) => {
        setPeople(list);
        setCompanies(Object.fromEntries(cos.map((c) => [c.id, c])));
      })
      .catch((e) => notify(e.message, true));
  }, [version, notify]);

  const companyList = useMemo(
    () => Object.values(companies).sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const locations = useMemo(() => {
    return Array.from(new Set(people.map((p) => valueFor(p, 'location', companies)).filter(Boolean))).sort();
  }, [people, companies]);

  const tags = useMemo(
    () => Array.from(new Set(people.flatMap((person) => person.tags ?? []))).sort((a, b) => a.localeCompare(b)),
    [people],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = people.filter((person) => {
      const company = person.companyId ? companies[person.companyId]?.name ?? '' : '';
      const personLocation = valueFor(person, 'location', companies);
      const haystack = [person.name, person.title, company, personLocation, person.email, person.phone, person.linkedin, person.owner, ...(person.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (!needle || haystack.includes(needle))
        && (!location || personLocation === location)
        && (!selectedTags.length || selectedTags.some((tag) => person.tags?.includes(tag)));
    });

    return [...list].sort((a, b) => {
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      const field: Attribute = sort === 'name' ? 'title' : sort;
      const av = sort === 'name' ? a.name : valueFor(a, field, companies);
      const bv = sort === 'name' ? b.name : valueFor(b, field, companies);
      return (av || '\uffff').localeCompare(bv || '\uffff') || a.name.localeCompare(b.name);
    });
  }, [people, companies, query, location, selectedTags, sort]);

  const studios = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const person of filtered) {
      const key = person.companyId ?? '';
      map.set(key, [...(map.get(key) ?? []), person]);
    }
    return [...map.entries()]
      .map(([id, members]) => ({ id, company: companies[id], name: companies[id]?.name ?? 'No company yet', members }))
      .sort((a, b) => {
        if (!a.id) return 1;
        if (!b.id) return -1;
        return sort === 'company' ? a.name.localeCompare(b.name) : b.members.length - a.members.length || a.name.localeCompare(b.name);
      });
  }, [filtered, companies, sort]);

  const uniformIndustry = useMemo(
    () => new Set(Object.values(companies).map((c) => c.industry ?? '')).size <= 1,
    [companies],
  );

  const toggleAttribute = (attribute: Attribute) => {
    setShown((current) => current.includes(attribute)
      ? current.filter((item) => item !== attribute)
      : [...current, attribute]);
  };

  return (
    <>
      <div className="people-controls">
        <div className="segmented" role="group" aria-label="Group contacts">
          <button aria-pressed={mode === 'studio'} onClick={() => setMode('studio')}>By company</button>
          <button aria-pressed={mode === 'az'} onClick={() => setMode('az')}>All people</button>
          <button
            aria-pressed={mode === 'recent'}
            onClick={() => { setMode('recent'); setSort('created'); }}
          >
            Recently added
          </button>
        </div>

        <input className="control-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter people\u2026" aria-label="Filter people" />

        <select className="control-select" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter by location">
          <option value="">All locations</option>
          {locations.map((item) => <option key={item}>{item}</option>)}
        </select>

        <select
          className="control-select"
          value={sort}
          onChange={(event) => {
            const next = event.target.value as Sort;
            setSort(next);
            setMode(next === 'company' ? 'studio' : next === 'created' ? 'recent' : 'az');
          }}
          aria-label="Sort people"
        >
          <option value="name">Sort: name</option>
          <option value="company">Sort: company</option>
          <option value="location">Sort: location</option>
          <option value="title">Sort: role</option>
          <option value="created">Sort: recently added</option>
          <option value="updated">Sort: recently updated</option>
        </select>

        <details className="field-picker">
          <summary>Show fields <span>{shown.length}</span></summary>
          <div className="field-menu">
            {ATTRIBUTES.map((attribute) => (
              <label key={attribute.id}>
                <input type="checkbox" checked={shown.includes(attribute.id)} onChange={() => toggleAttribute(attribute.id)} />
                {attribute.label}
              </label>
            ))}
          </div>
        </details>

        <button className="add-person-trigger" onClick={() => setAddOpen((open) => !open)} aria-expanded={addOpen}>
          <span aria-hidden="true">＋</span> Add person
        </button>

        <span className="people-result-count">{filtered.length} shown</span>
        <TagFilter tags={tags} value={selectedTags} onChange={setSelectedTags} multiple />
      </div>

      {addOpen && (
        <AddPersonForm
          people={people}
          companies={companyList}
          notify={notify}
          refresh={refresh}
          onClose={() => setAddOpen(false)}
          onOpen={(id) => onSelect({ kind: 'person', id })}
        />
      )}

      {!people.length ? (
        <Empty icon={<PigeonWaiting />} title="No contacts yet">
          Use Add person above to create your first contact and their company.
        </Empty>
      ) : !filtered.length ? (
        <Empty icon={<PigeonWaiting size={50} />} title="No people match">
          Clear the name, location, or tag filter to see everyone again.
        </Empty>
      ) : mode === 'az' || mode === 'recent' ? (
        <div className="rows people-rows">
          {filtered.map((person) => (
            <button className="row person-row" key={person.id} onClick={() => onSelect({ kind: 'person', id: person.id })}>
              <Monogram name={person.name} id={person.id} size="sm" />
              <span className="person-main">
                <span className="person-name">{person.name}</span>
                <TagList tags={person.tags} className="person-tag-list" />
              </span>
              <PersonAttributes
                person={person}
                shown={mode === 'recent' && !shown.includes('created') ? [...shown, 'created'] : shown}
                companies={companies}
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="roster">
          {studios.map((studio) => (
            <section className="studio" key={studio.id || 'none'}>
              <button className="studio-head" onClick={() => studio.company && onSelect({ kind: 'company', id: studio.id })} disabled={!studio.company}>
                <span>
                  <span className="studio-name">{studio.name}</span>
                  {(() => {
                    const meta = [uniformIndustry ? null : studio.company?.industry, studio.company?.domain ?? studio.company?.location].filter(Boolean);
                    return meta.length ? <span className="studio-meta">{meta.join(' \u00b7 ')}</span> : null;
                  })()}
                </span>
                <span className="studio-count">{studio.members.length} {studio.members.length === 1 ? 'person' : 'people'}</span>
              </button>

              <div className="bench">
                {studio.members.map((person) => (
                  <button className="person" key={person.id} onClick={() => onSelect({ kind: 'person', id: person.id })}>
                    <Monogram name={person.name} id={person.id} size="sm" />
                    <span className="person-main">
                      <span className="person-name">{person.name}</span>
                      <TagList tags={person.tags} className="person-tag-list" />
                    </span>
                    <PersonAttributes person={person} shown={shown.filter((field) => field !== 'company')} companies={companies} />
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

function PersonAttributes({ person, shown, companies }: { person: Person; shown: Attribute[]; companies: Record<string, Company> }) {
  const available = shown
    .map((field) => ({ field, label: ATTRIBUTES.find((item) => item.id === field)!.label, value: valueFor(person, field, companies) }))
    .filter((item) => item.value);

  if (!available.length) return null;
  return (
    <span className="person-attributes">
      {available.map((item) => (
        <span className="person-attribute" key={item.field}>
          <small>{item.label}</small>
          <span>{item.value}</span>
        </span>
      ))}
    </span>
  );
}

function AddPersonForm({
  people,
  companies,
  notify,
  refresh,
  onClose,
  onOpen,
}: {
  people: Person[];
  companies: Company[];
  notify: (text: string, error?: boolean) => void;
  refresh: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [companyFocused, setCompanyFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const companyNeedle = company.trim().toLowerCase();
  const suggestions = companyNeedle
    ? companies.filter((item) => item.name.toLowerCase().includes(companyNeedle)).slice(0, 6)
    : companies.slice(0, 6);
  const exactCompany = companies.find((item) => item.name.toLowerCase() === companyNeedle);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim() || !company.trim()) {
      setError('Name and company are required.');
      return;
    }

    setBusy(true);
    try {
      const canonicalCompany = exactCompany?.name ?? company.trim();
      const duplicate = people.find((person) => {
        const personCompany = companies.find((item) => item.id === person.companyId)?.name;
        return person.name.toLowerCase() === name.trim().toLowerCase()
          && personCompany?.toLowerCase() === canonicalCompany.toLowerCase();
      });
      if (duplicate) {
        notify(`${duplicate.name} is already in ${canonicalCompany}`);
        onClose();
        onOpen(duplicate.id);
        return;
      }

      const person = await api.createPerson({
        name: name.trim(),
        company: canonicalCompany,
        linkedin: linkedin.trim() || undefined,
      });
      notify(`${person.name} added to ${canonicalCompany}`);
      refresh();
      onClose();
      onOpen(person.id);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="add-person-slip" aria-label="Add person">
      <div className="add-person-head">
        <span className="add-person-mark" aria-hidden="true">＋</span>
        <div>
          <h2>Add a person</h2>
          <p>Choose an existing company, or type a new company name and it will be created with the contact.</p>
        </div>
        <button className="drawer-close" onClick={onClose} aria-label="Close add person">×</button>
      </div>
      <form className="add-person-form" onSubmit={(event) => void submit(event)}>
        <label className="add-person-link">
          <span>LinkedIn <small>optional</small></span>
          <input type="url" value={linkedin} onChange={(event) => setLinkedin(event.target.value)} placeholder="https://linkedin.com/in/jane-doe" autoFocus />
        </label>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" required />
        </label>
        <label className="company-combobox">
          <span>Company</span>
          <input
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            onFocus={() => setCompanyFocused(true)}
            onBlur={() => window.setTimeout(() => setCompanyFocused(false), 120)}
            placeholder="Search or create a company"
            role="combobox"
            aria-expanded={companyFocused && suggestions.length > 0}
            aria-autocomplete="list"
            required
          />
          {companyFocused && suggestions.length > 0 && (
            <span className="company-suggestions" role="listbox">
              {suggestions.map((item) => (
                <button type="button" key={item.id} role="option" onMouseDown={() => setCompany(item.name)}>
                  <span>{item.name}</span>
                  <small>{[item.industry, item.location].filter(Boolean).join(' · ') || 'Existing company'}</small>
                </button>
              ))}
            </span>
          )}
          {company.trim() && (
            <small className={exactCompany ? 'company-match existing' : 'company-match new'}>
              {exactCompany ? `Using existing company: ${exactCompany.name}` : `A new company named “${company.trim()}” will be created`}
            </small>
          )}
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="add-person-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button>
        </div>
      </form>
    </section>
  );
}
