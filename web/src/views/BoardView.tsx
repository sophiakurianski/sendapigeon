import { useEffect, useState } from 'react';
import { api, type Board, type ExpandedDeal } from '../api';
import { Postmark, PigeonWaiting, daysSince } from '../components/Pigeon';
import { Empty } from '../components/Drawer';
import { money, shortDate } from '../lib';
import type { ViewProps } from './types';

export function BoardView({ onSelect, notify, refresh, version }: ViewProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    api.board().then(setBoard).catch((e) => notify(e.message, true));
  }, [version, notify]);

  const drop = async (stageId: string) => {
    const id = dragging;
    setTarget(null);
    setDragging(null);
    if (!id || !board) return;
    const from = board.columns.find((col) => col.deals.some((d) => d.id === id));
    if (from?.id === stageId) return;
    try {
      await api.moveDeal(id, stageId);
      const stage = board.columns.find((col) => col.id === stageId)?.name ?? stageId;
      notify(`Moved to ${stage}`);
      refresh();
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  if (!board) return null;

  const anyDeals = board.columns.some((col) => col.deals.length) || board.won.length || board.lost.length;
  if (!anyDeals) {
    return (
      <Empty icon={<PigeonWaiting />} title="No deals in flight">
        Your contacts are loaded — the pipeline is where you track what you want from them.
        <code>pigeon deal add "Whipsaw intro" --company Whipsaw --value 24000</code>
      </Empty>
    );
  }

  return (
    <>
      <div className="board">
        {board.columns.map((col) => (
          <section key={col.id} className="column">
            <header className="column-head">
              <div className="column-name">
                <span>{col.name}</span>
                <span className="column-count">{col.count}</span>
              </div>
              <div className="column-value">{col.value ? money(col.value, board.currency) : '—'}</div>
            </header>
            <div
              className={target === col.id ? 'column-body is-target' : 'column-body'}
              onDragOver={(e) => {
                e.preventDefault();
                setTarget(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void drop(col.id);
              }}
            >
              {col.deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  currency={board.currency}
                  dragging={dragging === deal.id}
                  onDragStart={() => setDragging(deal.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setTarget(null);
                  }}
                  onOpen={() => onSelect({ kind: 'deal', id: deal.id })}
                />
              ))}
              {!col.deals.length && dragging && <div className="column-empty">drop it here</div>}
            </div>
          </section>
        ))}
      </div>

      <div className="board-foot">
        <span>
          open <b>{board.totals.open}</b> · {money(board.totals.openValue, board.currency)}
        </span>
        <span>
          weighted <b>{money(board.totals.weightedValue, board.currency)}</b>
        </span>
        <span>
          won <b>{board.totals.won}</b> · {money(board.totals.wonValue, board.currency)}
        </span>
        <span>
          lost <b>{board.totals.lost}</b>
        </span>
      </div>
    </>
  );
}

function DealCard({
  deal,
  currency,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  deal: ExpandedDeal;
  currency: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  // updatedAt moves whenever the deal changes stage, so it is the age of the
  // deal *here* — which is the number worth stamping on the card.
  const days = daysSince(deal.updatedAt);

  return (
    <article
      className={dragging ? 'deal is-dragging' : 'deal'}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', deal.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${deal.title}, ${days} days in this stage`}
    >
      <Postmark since={deal.updatedAt} days={days} />
      <div className="deal-title">{deal.title}</div>
      {deal.company && <div className="deal-company">{deal.company.name}</div>}
      <div className="deal-value">{money(deal.value, deal.currency ?? currency)}</div>
      {(deal.openTodos || deal.expectedCloseDate) && (
        <div className="deal-meta">
          {deal.overdueTodos ? <span className="overdue">{deal.overdueTodos} overdue</span> : null}
          {deal.openTodos ? <span>{deal.openTodos} to do</span> : null}
          {deal.expectedCloseDate ? <span>closes {shortDate(deal.expectedCloseDate)}</span> : null}
        </div>
      )}
      {deal.nextTodo && (
        <div className="deal-next">
          <span className="grow">{deal.nextTodo.title}</span>
          {deal.nextTodo.dueDate && <span className="due">{deal.nextTodo.dueDate.slice(5)}</span>}
        </div>
      )}
    </article>
  );
}
