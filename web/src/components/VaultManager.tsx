import { useEffect, useState } from 'react';
import { api, type VaultSummary } from '../api';
import { PigeonMark } from './Pigeon';

type FormMode = 'create' | 'open' | null;

const preferredCurrencies = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'SGD', 'JPY'];
const fallbackCurrencies = [...preferredCurrencies, 'CNY', 'HKD', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'ZAR'];
const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' });
const supportedCurrencies = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('currency')
  : fallbackCurrencies;
const currencies = [...new Set([...preferredCurrencies, ...supportedCurrencies])]
  .map((code) => ({ code, name: currencyNames.of(code) ?? code }))
  .sort((a, b) => {
    const aPreferred = preferredCurrencies.indexOf(a.code);
    const bPreferred = preferredCurrencies.indexOf(b.code);
    if (aPreferred >= 0 || bPreferred >= 0) {
      if (aPreferred < 0) return 1;
      if (bPreferred < 0) return -1;
      return aPreferred - bPreferred;
    }
    return a.name.localeCompare(b.name);
  });

export function VaultManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [mode, setMode] = useState<FormMode>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => api.vaults().then(setVaults).catch((caught) => setError(caught.message));

  useEffect(() => {
    if (!open) return;
    setMode(null);
    setError('');
    void load();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activate = async (vaultPath: string) => {
    if (busy) return;
    setBusy(vaultPath);
    setError('');
    try {
      await api.switchVault(vaultPath);
      window.location.hash = '#/board';
      window.location.reload();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy('');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(mode ?? 'form');
    setError('');
    try {
      if (mode === 'create') await api.createVault({ name: name.trim(), path: path.trim(), currency });
      else await api.openVault(path.trim());
      window.location.hash = '#/board';
      window.location.reload();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy('');
    }
  };

  const chooseFolder = async () => {
    if (busy) return;
    setBusy('picker');
    setError('');
    try {
      const picked = await api.pickFolder(path.trim());
      if (picked.path) setPath(picked.path);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy('');
    }
  };

  const forget = async (vault: VaultSummary) => {
    if (vault.current || busy) return;
    if (!window.confirm(`Forget “${vault.name}”? Its folder and data will not be deleted.`)) return;
    setBusy(vault.path);
    try {
      await api.forgetVault(vault.path);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="vault-manager-scrim" onClick={onClose} />
      <section className="vault-manager" role="dialog" aria-modal="true" aria-labelledby="vault-manager-title">
        <header className="vault-manager-head">
          <span className="vault-manager-mark" aria-hidden="true"><PigeonMark size={28} /></span>
          <div>
            <div className="drawer-kicker">Pigeon lofts</div>
            <h2 id="vault-manager-title">Choose a vault</h2>
            <p>Each vault is its own folder with separate contacts, companies, boards and notes.</p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close vault manager">×</button>
        </header>

        <div className="vault-manager-body">
          <div className="vault-list">
            {vaults.map((vault) => (
              <div className={vault.current ? 'vault-choice current' : 'vault-choice'} key={vault.path}>
                <button className="vault-choice-main" onClick={() => !vault.current && vault.exists && void activate(vault.path)} disabled={vault.current || !vault.exists || Boolean(busy)}>
                  <span className="vault-choice-icon" aria-hidden="true"><PigeonMark size={22} /></span>
                  <span className="vault-choice-copy">
                    <span className="vault-choice-name">{vault.name}</span>
                    <span className="vault-choice-path">{vault.path}</span>
                    <span className="vault-choice-stats">
                      {vault.exists ? `${vault.people} people · ${vault.companies} companies` : 'Folder is unavailable'}
                    </span>
                  </span>
                  <span className="vault-choice-state">{vault.current ? 'Open' : busy === vault.path ? 'Opening…' : 'Open →'}</span>
                </button>
                {!vault.current && (
                  <button className="vault-forget" onClick={() => void forget(vault)} aria-label={`Forget ${vault.name}`} title="Forget vault">×</button>
                )}
              </div>
            ))}
          </div>

          <div className="vault-manager-actions">
            <button
              className={mode === 'create' ? 'vault-action active' : 'vault-action'}
              onClick={() => { setMode(mode === 'create' ? null : 'create'); setError(''); }}
            >
              <span aria-hidden="true">＋</span>
              <span><b>Create a vault</b><small>Start a clean CRM in a new folder</small></span>
            </button>
            <button
              className={mode === 'open' ? 'vault-action active' : 'vault-action'}
              onClick={() => { setMode(mode === 'open' ? null : 'open'); setError(''); }}
            >
              <span aria-hidden="true">↗</span>
              <span><b>Open a folder</b><small>Add an existing SendAPigeon vault</small></span>
            </button>
          </div>

          {mode && (
            <form className="vault-form" onSubmit={(event) => void submit(event)}>
              {mode === 'create' && (
                <label>
                  <span>Vault name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Studio contacts" required autoFocus />
                </label>
              )}
              <label className="vault-path-field">
                <span>Folder path</span>
                <span className="vault-path-control">
                  <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="~/Documents/Studio Contacts" required autoFocus={mode === 'open'} />
                  <button type="button" className="vault-folder-button" onClick={() => void chooseFolder()} disabled={Boolean(busy)}>
                    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M2.5 5.25h5l1.4 1.7h8.6v7.8H2.5z" />
                      <path d="M2.5 7V4.1h4.4l1.5 1.8" />
                    </svg>
                    {busy === 'picker' ? 'Choosing…' : 'Choose…'}
                  </button>
                </span>
                <small>Pick a folder on this computer or paste its path. You can create a new folder in the picker.</small>
              </label>
              {mode === 'create' && (
                <label className="vault-currency-field">
                  <span>Currency</span>
                  <select value={currency} onChange={(event) => setCurrency(event.target.value)} required>
                    {currencies.map((item) => (
                      <option value={item.code} key={item.code}>{item.code} — {item.name}</option>
                    ))}
                  </select>
                  <small>Used for deal values and pipeline totals.</small>
                </label>
              )}
              {error && <div className="form-error vault-form-error" role="alert">{error}</div>}
              <div className="vault-form-actions">
                <button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancel</button>
                <button className="btn" disabled={Boolean(busy)}>
                  {busy && busy !== 'picker' ? mode === 'create' ? 'Creating…' : 'Opening…' : mode === 'create' ? 'Create and open' : 'Open vault'}
                </button>
              </div>
            </form>
          )}
          {!mode && error && <div className="form-error vault-manager-error" role="alert">{error}</div>}
        </div>
      </section>
    </>
  );
}
