import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Deal, type Person } from '../api';
import { Empty } from '../components/Drawer';
import { Monogram, PigeonWaiting } from '../components/Pigeon';
import { money } from '../lib';
import type { ViewProps } from './types';

export function CompaniesView({ onSelect, notify, version, config }: ViewProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  useEffect(() => {
    Promise.all([api.companies(), api.people(), api.deals({ status: 'open' })])
      .then(([cos, ppl, dls]) => {
        setCompanies(cos);
        setPeople(ppl);
        setDeals(dls);
      })
      .catch((e) => notify(e.message, true));
  }, [version, notify]);

  /** Busiest accounts first — a company with six contacts matters more than an
   *  alphabetically lucky one with none. */
  const ranked = useMemo(() => {
    return companies
      .map((co) => {
        const open = deals.filter((d) => d.companyId === co.id);
        return {
          co,
          headcount: people.filter((p) => p.companyId === co.id).length,
          open: open.length,
          value: open.reduce((sum, d) => sum + (d.value ?? 0), 0),
        };
      })
      .sort((a, b) => b.headcount - a.headcount || b.value - a.value || a.co.name.localeCompare(b.co.name));
  }, [companies, people, deals]);

  const anyDeals = deals.length > 0;

  /* A value shared by every single company tells you nothing — if all 25 are
     "Industrial Design", showing it 25 times is noise, not information. */
  const uniformIndustry = useMemo(() => {
    const set = new Set(companies.map((c) => c.industry ?? ''));
    return set.size <= 1;
  }, [companies]);

  if (!companies.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="No companies yet">
        Add one with <code>pigeon company add "Acme Corp" --domain acme.com</code>, or add a person and the
        company is created for you.
      </Empty>
    );
  }

  return (
    <div className="grid">
      {ranked.map(({ co, headcount, open, value }) => (
        <button className="card" key={co.id} onClick={() => onSelect({ kind: 'company', id: co.id })}>
          <div className="card-head">
            <Monogram name={co.name} id={co.id} size="md" />
            <div style={{ minWidth: 0 }}>
              <div className="card-title">{co.name}</div>
              <div className="card-sub">
              {(uniformIndustry ? null : co.industry) ?? co.domain ?? co.location ?? '\u2014'}
            </div>
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
                <div className="stat-n">{money(value, config?.currency).replace(/^\S+\s/, '')}</div>
                <div className="stat-l">pipeline</div>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
