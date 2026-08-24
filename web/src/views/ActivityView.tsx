import { useEffect, useMemo, useState } from 'react';
import { api, type ActivityEvent } from '../api';
import { Empty } from '../components/Drawer';
import { PigeonWaiting } from '../components/Pigeon';
import { shortDate } from '../lib';
import type { Selection } from './DetailDrawer';
import type { ViewProps } from './types';

const OPENABLE = new Set(['deal', 'person', 'company', 'note']);

/** "created", "stage_changed" → what a person would say happened. */
function phrase(event: ActivityEvent): string {
  const verb = event.action.replace(/_/g, ' ');
  return `${verb} ${event.kind}`;
}

export function ActivityView({ onSelect, notify, version }: ViewProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    api.activity(120).then(setEvents).catch((e) => notify(e.message, true));
  }, [version, notify]);

  /** Grouped by day — an activity log without days is just a wall. */
  const byDay = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const event of events) {
      const day = event.ts.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), event]);
    }
    return [...map.entries()];
  }, [events]);

  if (!events.length) {
    return (
      <Empty icon={<PigeonWaiting />} title="Nothing has happened yet">
        Every change made from the CLI, an agent or this page is recorded in <code>data/activity.jsonl</code>.
      </Empty>
    );
  }

  return (
    <div className="rows">
      {byDay.map(([day, group]) => (
        <div key={day}>
          <div className="group-label">
            <span>{shortDate(day)}</span>
            <span>{group.length}</span>
          </div>
          {group.map((event, i) => (
            <button
              className="row"
              key={`${event.ts}-${i}`}
              onClick={() => OPENABLE.has(event.kind) && onSelect({ kind: event.kind as Selection['kind'], id: event.id })}
            >
              <span className="row-main">
                <span className="row-title">
                  {event.summary ?? event.id}
                </span>
                <span className="row-sub">
                  {phrase(event)}
                  {event.actor ? ` · ${event.actor}` : ''}
                </span>
              </span>
              <span className="row-date">{event.ts.slice(11, 16)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
