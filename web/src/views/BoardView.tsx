import { useEffect, useRef, useState } from 'react';
import { api, type Board, type ExpandedDeal, type PeopleBoardTemplate, type PersonBoard, type PersonBoardCard, type Stage } from '../api';
import { Monogram, Postmark, PigeonWaiting, daysSince } from '../components/Pigeon';
import { Empty } from '../components/Drawer';
import { money, shortDate } from '../lib';
import type { ViewProps } from './types';

type BoardMode = 'people' | 'deals';
type BoardDraft = { id?: string; name: string; stages: Stage[] };

export function BoardView({ onSelect, notify, refresh, version }: ViewProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [peopleBoard, setPeopleBoard] = useState<PersonBoard | null>(null);
  const [mode, setMode] = useState<BoardMode>('people');
  const [templates, setTemplates] = useState<PeopleBoardTemplate[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [editor, setEditor] = useState<BoardDraft | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.board(), api.config()])
      .then(([deals, config]) => {
        setBoard(deals);
        setTemplates(config.peopleBoards);
        setSelectedBoard((current) => config.peopleBoards.some((item) => item.id === current) ? current : config.peopleBoards[0]?.id ?? '');
      })
      .catch((error) => notify(error.message, true));
  }, [version, notify]);

  useEffect(() => {
    if (!selectedBoard) return;
    api.peopleBoard(selectedBoard).then(setPeopleBoard).catch((error) => notify(error.message, true));
  }, [selectedBoard, version, notify]);

  const drop = async (event: React.DragEvent, stageId: string) => {
    const id = event.dataTransfer.getData('text/plain') || dragging;
    event.dataTransfer.dropEffect = 'move';
    setTarget(null);
    setDragging(null);
    if (!id) return;
    const previousPeopleBoard = peopleBoard;
    try {
      let message: string;
      if (mode === 'people') {
        const sourceIndex = peopleBoard?.columns.findIndex((column) => column.people.some((person) => person.id === id)) ?? -1;
        const targetIndex = peopleBoard?.columns.findIndex((column) => column.id === stageId) ?? -1;
        const targetStage = targetIndex >= 0 ? peopleBoard?.columns[targetIndex]?.name : stageId;
        if (sourceIndex === targetIndex) return;
        setPeopleBoard((current) => current ? moveCard(current, id, stageId) : current);
        const result = await api.movePersonStage(id, stageId);
        message = result.todo
          ? `Moved to ${targetStage} · next: ${result.todo.title}`
          : `Moved to ${targetStage} · workflow complete`;
      } else {
        await api.moveDeal(id, stageId);
        const stage = board?.columns.find((column) => column.id === stageId)?.name ?? stageId;
        message = `Moved to ${stage}`;
      }
      notify(message);
      refresh();
    } catch (error) {
      if (mode === 'people' && previousPeopleBoard) setPeopleBoard(previousPeopleBoard);
      notify((error as Error).message, true);
    }
  };

  const saveBoard = async () => {
    if (!editor || editorBusy) return;
    const name = editor.name.trim();
    const stages = editor.stages.map((stage) => ({ ...stage, name: stage.name.trim() })).filter((stage) => stage.name);
    if (!name || !stages.length) {
      setEditorError(!name ? 'Give the board a name.' : 'Add at least one column.');
      return;
    }
    setEditorBusy(true);
    setEditorError('');
    try {
      const saved = editor.id
        ? await api.updatePeopleBoard(editor.id, { name, stages })
        : await api.createPeopleBoard({ name, stages: stages.map(({ name: stageName }) => ({ name: stageName })) });
      const config = await api.config();
      setTemplates(config.peopleBoards);
      setSelectedBoard(saved.id);
      setEditor(null);
      notify(editor.id ? 'Board updated' : `${saved.name} created`);
      refresh();
    } catch (error) {
      setEditorError((error as Error).message);
    } finally {
      setEditorBusy(false);
    }
  };

  const deleteBoard = async () => {
    if (!editor?.id || editorBusy) return;
    setEditorBusy(true);
    setEditorError('');
    try {
      await api.deletePeopleBoard(editor.id);
      const config = await api.config();
      setTemplates(config.peopleBoards);
      setSelectedBoard(config.peopleBoards[0]?.id ?? '');
      setEditor(null);
      notify('Board deleted');
      refresh();
    } catch (error) {
      setEditorError((error as Error).message);
    } finally {
      setEditorBusy(false);
    }
  };

  if (!board || !peopleBoard) return null;
  const anyDeals = board.columns.some((column) => column.deals.length) || board.won.length || board.lost.length;

  return (
    <>
      <div className="toolbar board-switcher">
        <div className="segmented" role="group" aria-label="Board type">
          <button aria-pressed={mode === 'people'} onClick={() => setMode('people')}>People workflow</button>
          <button aria-pressed={mode === 'deals'} onClick={() => setMode('deals')}>Deals</button>
        </div>
        {mode === 'people' && (
          <div className="people-board-tools">
            <select
              className="board-picker"
              value={selectedBoard}
              onChange={(event) => { setPeopleBoard(null); setSelectedBoard(event.target.value); setEditor(null); }}
              aria-label="Choose people board"
            >
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button
              className="board-tool-button"
              onClick={() => {
                const template = templates.find((item) => item.id === selectedBoard);
                if (template) setEditor({ id: template.id, name: template.name, stages: template.stages.map((stage) => ({ ...stage })) });
              }}
              aria-label="Edit this board"
              title="Edit this board"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11.8-.5 2.1 2.1-.5L13.2 4.8 11.2 2.8zM9.9 4.1l2 2" /></svg>
            </button>
            <button
              className="board-new-button"
              onClick={() => setEditor({ name: 'New board', stages: [
                { id: '', name: 'Reach out' },
                { id: '', name: 'Follow up' },
                { id: '', name: 'Meeting' },
              ] })}
            >
              <span aria-hidden="true">＋</span> New board
            </button>
          </div>
        )}
        <span className="board-mode-note">
          {mode === 'people' ? 'Drag a person to a milestone; the following stage becomes their to-do.' : 'Deal value by sales stage.'}
        </span>
      </div>

      {mode === 'people' && editor && (
        <BoardEditor
          draft={editor}
          counts={Object.fromEntries((peopleBoard?.columns ?? []).map((column) => [column.id, column.count]))}
          canDelete={templates.length > 1 && Boolean(editor.id)}
          busy={editorBusy}
          error={editorError}
          onChange={setEditor}
          onSave={() => void saveBoard()}
          onDelete={() => void deleteBoard()}
          onCancel={() => { setEditor(null); setEditorError(''); }}
        />
      )}

      {mode === 'people' ? (
        peopleBoard.total ? (
          <div className={dragging ? 'board people-board is-dragging' : 'board people-board'}>
            {peopleBoard.columns.map((column) => (
              <section key={column.id} className="column">
                <header className="column-head">
                  <div className="column-name"><span>{column.name}</span><span className="column-count">{column.count}</span></div>
                  <div className="column-value">{column.count === 1 ? '1 person' : `${column.count} people`}</div>
                </header>
                <div
                  className={target === column.id ? 'column-body is-target' : 'column-body'}
                  onDragEnter={(event) => { event.preventDefault(); setTarget(column.id); }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(column.id); }}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setTarget(null); }}
                  onDrop={(event) => { event.preventDefault(); void drop(event, column.id); }}
                >
                  {column.people.map((person) => (
                    <PersonStageCard
                      key={person.id}
                      person={person}
                      stageName={column.name}
                      dragging={dragging === person.id}
                      onDragStart={() => setDragging(person.id)}
                      onDragEnd={() => { setDragging(null); setTarget(null); }}
                      onOpen={() => onSelect({ kind: 'person', id: person.id })}
                    />
                  ))}
                  {!column.people.length && dragging && <div className="column-empty">drop them here</div>}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <Empty icon={<PigeonWaiting />} title={`No people on ${peopleBoard.name}`}>
            Open a person and choose this board to start its first stage and linked to-do.
          </Empty>
        )
      ) : anyDeals ? (
        <DealBoard board={board} dragging={dragging} target={target} setDragging={setDragging} setTarget={setTarget} drop={drop} onSelect={onSelect} />
      ) : (
        <Empty icon={<PigeonWaiting />} title="No deals in flight">
          Your people workflow is ready. Deals are for opportunities with a value and close date.
        </Empty>
      )}
    </>
  );
}

function PersonStageCard({ person, stageName, dragging, onDragStart, onDragEnd, onOpen }: {
  person: PersonBoardCard;
  stageName: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const suppressOpen = useRef(false);
  return (
    <article
      className={dragging ? 'deal person-stage-card is-dragging' : 'deal person-stage-card'}
      draggable
      onDragStart={(event) => { suppressOpen.current = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', person.id); onDragStart(); }}
      onDragEnd={() => { onDragEnd(); window.setTimeout(() => { suppressOpen.current = false; }, 0); }}
      onClick={() => { if (!suppressOpen.current) onOpen(); }}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }}
      tabIndex={0}
      role="button"
      aria-label={`${person.name}, ${stageName}`}
    >
      <div className="person-stage-head">
        <Monogram name={person.name} id={person.id} size="sm" />
        <div className="grow">
          <div className="deal-title">{person.name}</div>
          <div className="deal-company">{person.company?.name ?? person.title ?? 'No company'}</div>
        </div>
      </div>
      <div className="stage-drag-hint" aria-hidden="true">
        <span className="drag-grip">⠿</span>
        <span>{person.stageTodo ? `Next: ${person.stageTodo.title}` : 'Workflow complete'}</span>
      </div>
    </article>
  );
}

function moveCard(board: PersonBoard, personId: string, targetId: string): PersonBoard {
  const person = board.columns.flatMap((column) => column.people).find((item) => item.id === personId);
  if (!person) return board;
  const moved: PersonBoardCard = {
    ...person,
    stage: targetId,
    stageCompletedAt: undefined,
    stageTodo: null,
  };
  const columns = board.columns.map((column) => {
    const people = column.people.filter((item) => item.id !== personId);
    if (column.id === targetId) people.push(moved);
    people.sort((a, b) => a.name.localeCompare(b.name));
    return { ...column, people, count: people.length };
  });
  return { ...board, columns };
}

function BoardEditor({ draft, counts, canDelete, busy, error, onChange, onSave, onDelete, onCancel }: {
  draft: BoardDraft;
  counts: Record<string, number>;
  canDelete: boolean;
  busy: boolean;
  error: string;
  onChange: (draft: BoardDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const changeStage = (index: number, name: string) => {
    onChange({ ...draft, stages: draft.stages.map((stage, itemIndex) => itemIndex === index ? { ...stage, name } : stage) });
  };
  const moveStage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.stages.length) return;
    const stages = [...draft.stages];
    [stages[index], stages[target]] = [stages[target], stages[index]];
    onChange({ ...draft, stages });
  };
  const removeStage = (index: number) => {
    const stage = draft.stages[index];
    if (stage.id && counts[stage.id]) return;
    onChange({ ...draft, stages: draft.stages.filter((_, itemIndex) => itemIndex !== index) });
  };

  return (
    <section className="board-editor" aria-label={draft.id ? 'Edit board' : 'Create board'}>
      <div className="board-editor-head">
        <div>
          <div className="drawer-kicker">Board template</div>
          <h2>{draft.id ? 'Edit workflow' : 'Create a workflow'}</h2>
        </div>
        <button className="drawer-close" onClick={onCancel} aria-label="Close board editor">×</button>
      </div>
      <label className="board-name-field">
        <span>Board name</span>
        <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} autoFocus />
      </label>
      <div className="board-editor-label"><span>Columns</span><small>Drag cards between these stages on the board.</small></div>
      <div className="board-column-editor">
        {draft.stages.map((stage, index) => {
          const occupied = Boolean(stage.id && counts[stage.id]);
          return (
            <div className="board-column-row" key={`${stage.id || 'new'}-${index}`}>
              <span className="board-column-number">{index + 1}</span>
              <input value={stage.name} onChange={(event) => changeStage(index, event.target.value)} aria-label={`Column ${index + 1} name`} />
              {occupied && <small>{counts[stage.id]} here</small>}
              <button onClick={() => moveStage(index, -1)} disabled={index === 0} aria-label={`Move ${stage.name} left`}>←</button>
              <button onClick={() => moveStage(index, 1)} disabled={index === draft.stages.length - 1} aria-label={`Move ${stage.name} right`}>→</button>
              <button
                className="remove-column"
                onClick={() => removeStage(index)}
                disabled={occupied || draft.stages.length === 1}
                aria-label={occupied ? `Move people out of ${stage.name} before removing it` : `Remove ${stage.name}`}
                title={occupied ? 'Move everyone out of this column first' : 'Remove column'}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="add-column-button"
        onClick={() => onChange({ ...draft, stages: [...draft.stages, { id: '', name: '' }] })}
      >
        <span aria-hidden="true">＋</span> Add column
      </button>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="board-editor-actions">
        {canDelete && <button className="btn danger ghost" onClick={onDelete} disabled={busy}>Delete board</button>}
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save board'}</button>
      </div>
    </section>
  );
}

function DealBoard({ board, dragging, target, setDragging, setTarget, drop, onSelect }: {
  board: Board;
  dragging: string | null;
  target: string | null;
  setDragging: (id: string | null) => void;
  setTarget: (id: string | null) => void;
  drop: (event: React.DragEvent, stage: string) => Promise<void>;
  onSelect: ViewProps['onSelect'];
}) {
  return (
    <>
      <div className="board">
        {board.columns.map((column) => (
          <section key={column.id} className="column">
            <header className="column-head">
              <div className="column-name"><span>{column.name}</span><span className="column-count">{column.count}</span></div>
              <div className="column-value">{column.value ? money(column.value, board.currency) : '—'}</div>
            </header>
            <div
              className={target === column.id ? 'column-body is-target' : 'column-body'}
              onDragEnter={(event) => { event.preventDefault(); setTarget(column.id); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(column.id); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setTarget(null); }}
              onDrop={(event) => { event.preventDefault(); void drop(event, column.id); }}
            >
              {column.deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  currency={board.currency}
                  dragging={dragging === deal.id}
                  onDragStart={() => setDragging(deal.id)}
                  onDragEnd={() => { setDragging(null); setTarget(null); }}
                  onOpen={() => onSelect({ kind: 'deal', id: deal.id })}
                />
              ))}
              {!column.deals.length && dragging && <div className="column-empty">drop it here</div>}
            </div>
          </section>
        ))}
      </div>
      <div className="board-foot">
        <span>open <b>{board.totals.open}</b> · {money(board.totals.openValue, board.currency)}</span>
        <span>weighted <b>{money(board.totals.weightedValue, board.currency)}</b></span>
        <span>won <b>{board.totals.won}</b> · {money(board.totals.wonValue, board.currency)}</span>
        <span>lost <b>{board.totals.lost}</b></span>
      </div>
    </>
  );
}

function DealCard({ deal, currency, dragging, onDragStart, onDragEnd, onOpen }: {
  deal: ExpandedDeal;
  currency: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const days = daysSince(deal.updatedAt);
  const suppressOpen = useRef(false);
  return (
    <article
      className={dragging ? 'deal is-dragging' : 'deal'}
      draggable
      onDragStart={(event) => { suppressOpen.current = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', deal.id); onDragStart(); }}
      onDragEnd={() => { onDragEnd(); window.setTimeout(() => { suppressOpen.current = false; }, 0); }}
      onClick={() => { if (!suppressOpen.current) onOpen(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
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
      {deal.nextTodo && <div className="deal-next"><span className="grow">{deal.nextTodo.title}</span>{deal.nextTodo.dueDate && <span className="due">{deal.nextTodo.dueDate.slice(5)}</span>}</div>}
    </article>
  );
}
