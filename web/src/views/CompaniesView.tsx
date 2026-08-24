import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Deal, type Person } from '../api';
import { Empty } from '../components/Drawer';
import { Monogram, PigeonWaiting } from '../components/Pigeon';
import { money, relativeDay } from '../lib';
import type { ViewProps } from './types';

type CompanyMode = 'cards' | 'list';
type CompanySort = 'contacts' | 'name' | 'created' | 'updated' | 'location' | 'industry' | 'pipeline';

interface CompanyRow {
  co: Company;
  headcount: number;
  open: number;
  value: number;
}

const compareText = (a = '', b = '') => (a || '\uffff').localeCompare(b || '\uffff');

export function CompaniesView({ onSelect, notify, version, config }: ViewProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [mode, setMode] = useState<CompanyMode>('cards');
  const [sort, setSort] = useState<CompanySort>('contacts');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [industry, setIndustry] = useState('');

  useEffect(() => {
    Promise.all([api.companies(), api.people(), api.deals({ status: 'open' })])
      .then(([cos, ppl, dls]) => {
        setCompanies(cos);
        setPeople(ppl);
        setDeals(dls);
      })
      .catch((e) => notify(e.message, true));
  }, [version, notify]);

  const locations = useMemo(
    () => [...new Set(companies.map((company) => company.location).filter((value): value is string => Boolean(value)))].sort(),
    [companies],
  );
  const industries = useMemo(
    () => [...new Set(companies.map((company) => company.industry).filter((value): value is string => Boolean(value)))].sort(),
    [companies],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const metrics: CompanyRow[] = companies.map((co) => {
      const openDeals = deals.filter((deal) => deal.companyId === co.id);
      return {
        co,
        headcount: people.filter((person) => person.companyId === co.id).length,
        open: openDeals.length,
        value: openDeals.reduce((sum, deal) => sum + (deal.value ?? 0), 0),
      };
    });

    return metrics
      .filter(({ co }) => {
        const haystack = [co.name, co.domain, co.industry, co.location, co.owner, ...(co.tags ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return (!needle || haystack.includes(needle))
          && (!location || co.location === location)
          && (!industry || co.industry === industry);
      })
      .sort((a, b) => {
        if (sort === 'contacts') return b.headcount - a.headcount || b.value - a.value || a.co.name.localeCompare(b.co.name);
        if (sort === 'pipeline') return b.value - a.value || b.open - a.open || a.co.name.localeCompare(b.co.name);
        if (sort === 'created') return b.co.createdAt.localeCompare(a.co.createdAt);
        if (sort === 'updated') return b.co.updatedAt.localeCompare(a.co.updatedAt);
        if (sort === 'location') return compareText(a.co.location, b.co.location) || a.co.name.localeCompare(b.co.name);
        if (sort === 'industry') return compareText(a.co.industry, b.co.industry) || a.co.name.localeCompare(b.co.name);
        return a.co.name.localeCompare(b.co.name);
      });
  }, [companies, people, deals, query, location, industry, sort]);

  const anyDeals = deals.length > 0;
  const uniformIndustry = industries.length <= 1;

  if (!companies.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="No companies yet">
        Add a person and their company will be created automatically.
      </Empty>
    );
  }

  return (
    <>
      <div className="people-controls companies-controls">
        <div className="segmented layout-toggle" role="group" aria-label="Company layout">
          <button aria-pressed={mode === 'cards'} onClick={() => setMode('cards')} aria-label="Grid view" title="Grid view">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
              <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
              <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
              <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
            </svg>
          </button>
          <button aria-pressed={mode === 'list'} onClick={() => setMode('list')} aria-label="List view" title="List view">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3h9M5.5 8h9M5.5 13h9" />
              <circle cx="2" cy="3" r=".8" />
              <circle cx="2" cy="8" r=".8" />
              <circle cx="2" cy="13" r=".8" />
            </svg>
          </button>
        </div>

        <input
          className="control-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter companies…"
          aria-label="Filter companies"
        />

        <select className="control-select" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter companies by location">
          <option value="">All locations</option>
          {locations.map((item) => <option key={item}>{item}</option>)}
        </select>

        <select className="control-select" value={industry} onChange={(event) => setIndustry(event.target.value)} aria-label="Filter companies by industry">
          <option value="">All industries</option>
          {industries.map((item) => <option key={item}>{item}</option>)}
        </select>

        <select className="control-select" value={sort} onChange={(event) => setSort(event.target.value as CompanySort)} aria-label="Sort companies">
          <option value="contacts">Sort: most contacts</option>
          <option value="name">Sort: name</option>
          <option value="created">Sort: recently added</option>
          <option value="updated">Sort: recently updated</option>
          <option value="location">Sort: location</option>
          <option value="industry">Sort: industry</option>
          <option value="pipeline">Sort: pipeline</option>
        </select>

        <span className="people-result-count">{rows.length} shown</span>
      </div>

      {!rows.length ? (
        <Empty icon={<PigeonWaiting size={50} />} title="No companies match">
          Clear a search or filter to see your companies again.
        </Empty>
      ) : mode === 'cards' ? (
        <div className="grid company-grid">
          {rows.map((row) => (
            <CompanyCard
              key={row.co.id}
              row={row}
              currency={config?.currency}
              anyDeals={anyDeals}
              uniformIndustry={uniformIndustry}
              dateMode={sort === 'created' ? 'created' : sort === 'updated' ? 'updated' : null}
              onOpen={() => onSelect({ kind: 'company', id: row.co.id })}
            />
          ))}
        </div>
      ) : (
        <div className="rows company-rows">
          {rows.map((row) => (
            <CompanyListRow
              key={row.co.id}
              row={row}
              currency={config?.currency}
              anyDeals={anyDeals}
              uniformIndustry={uniformIndustry}
              dateMode={sort === 'created' ? 'created' : sort === 'updated' ? 'updated' : null}
              onOpen={() => onSelect({ kind: 'company', id: row.co.id })}
            />
          ))}
        </div>
      )}
    </>
  );
}

function CompanyCard({ row, currency, anyDeals, uniformIndustry, dateMode, onOpen }: {
  row: CompanyRow;
  currency?: string;
  anyDeals: boolean;
  uniformIndustry: boolean;
  dateMode: 'created' | 'updated' | null;
  onOpen: () => void;
}) {
  const { co, headcount, open, value } = row;
  const date = dateMode ? co[dateMode === 'created' ? 'createdAt' : 'updatedAt'] : '';
  return (
    <button className="card" onClick={onOpen}>
      <div className="card-head">
        <Monogram name={co.name} id={co.id} size="md" />
        <div className="company-card-main">
          <div className="card-title">{co.name}</div>
          <div className="card-sub">{(uniformIndustry ? null : co.industry) ?? co.domain ?? co.location ?? '—'}</div>
          {dateMode && <div className="card-date">{dateMode === 'created' ? 'Added' : 'Updated'} {relativeDay(date.slice(0, 10))}</div>}
        </div>
      </div>
      <div className="card-stats">
        <div>
          <div className={headcount ? 'stat-n' : 'stat-n quiet'}>{headcount || '—'}</div>
          <div className="stat-l">{headcount === 1 ? 'contact' : 'contacts'}</div>
        </div>
        {anyDeals && (
          <div>
            <div className={open ? 'stat-n' : 'stat-n quiet'}>{open || '—'}</div>
            <div className="stat-l">open</div>
          </div>
        )}
        {value > 0 && (
          <div>
            <div className="stat-n">{money(value, currency).replace(/^\S+\s/, '')}</div>
            <div className="stat-l">pipeline</div>
          </div>
        )}
      </div>
    </button>
  );
}

function CompanyListRow({ row, currency, anyDeals, uniformIndustry, dateMode, onOpen }: {
  row: CompanyRow;
  currency?: string;
  anyDeals: boolean;
  uniformIndustry: boolean;
  dateMode: 'created' | 'updated' | null;
  onOpen: () => void;
}) {
  const { co, headcount, open, value } = row;
  const date = dateMode ? co[dateMode === 'created' ? 'createdAt' : 'updatedAt'] : '';
  return (
    <button className="row company-row" onClick={onOpen}>
      <Monogram name={co.name} id={co.id} size="sm" />
      <span className="company-list-main">
        <span className="person-name">{co.name}</span>
        <small>{co.domain ?? co.website ?? 'No domain saved'}</small>
      </span>
      <span className="company-list-fields">
        {!uniformIndustry && co.industry && <CompanyField label="Industry" value={co.industry} />}
        {co.location && <CompanyField label="Location" value={co.location} />}
        {dateMode && <CompanyField label={dateMode === 'created' ? 'Added' : 'Updated'} value={relativeDay(date.slice(0, 10))} />}
        <CompanyField label="Contacts" value={String(headcount)} />
        {anyDeals && <CompanyField label="Open deals" value={String(open)} />}
        {value > 0 && <CompanyField label="Pipeline" value={money(value, currency)} />}
      </span>
    </button>
  );
}

function CompanyField({ label, value }: { label: string; value: string }) {
  return (
    <span className="person-attribute company-field">
      <small>{label}</small>
      <span>{value}</span>
    </span>
  );
}
