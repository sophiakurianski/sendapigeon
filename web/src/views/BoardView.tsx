import { useEffect, useRef, useState } from 'react';
import { api, type Board, type ExpandedDeal, type PeopleBoardTemplate, type PersonBoard, type PersonBoardCard, type Stage } from '../api';
import { Monogram, Postmark, PigeonWaiting, daysSince } from '../components/Pigeon';
import { Empty } from '../components/Drawer';
import { money, shortDate } from '../lib';
import type { ViewProps } from './types';

type BoardMode = 'people' | 'deals';
type BoardDraft = { id?: string; name: string; stages: Stage[] };
type PersonContextMenu = { person: PersonBoardCard; x: number; y: number };

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
  const [personMenu, setPersonMenu] = useState<PersonContextMenu | null>(null);
  const [personMenuBusy, setPersonMenuBusy] = useState(false);

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
    let cancelled = false;
    api.peopleBoard(selectedBoard)
      .then((nextBoard) => { if (!cancelled) setPeopleBoard(nextBoard); })
      .catch((error) => { if (!cancelled) notify(error.message, true); });
    return () => { cancelled = true; };
  }, [selectedBoard, version, notify]);

  useEffect(() => {
    if (!personMenu) return;
    const close = () => setPersonMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [personMenu]);

  const openPersonMenu = (person: PersonBoardCard, x: number, y: number) => {
    const menuWidth = 238;
    const menuHeight = 116;
    const edge = 10;
    setPersonMenu({
      person,
      x: Math.max(edge, Math.min(x, window.innerWidth - menuWidth - edge)),
      y: Math.max(edge, Math.min(y, window.innerHeight - menuHeight - edge)),
    });
  };

  const removePersonFromFlow = async () => {
    if (!personMenu || personMenuBusy) return;
    const { person } = personMenu;
    const previous = peopleBoard;
    setPersonMenuBusy(true);
    setPeopleBoard((current) => current ? removeCard(current, person.id) : current);
    try {
      await api.removePersonFromWorkflow(person.id);
      setPersonMenu(null);
      notify(`${person.name} removed from the flow`);
      refresh();
    } catch (error) {
      if (previous) setPeopleBoard(previous);
      notify((error as Error).message, true);
    } finally {
      setPersonMenuBusy(false);
    }
  };

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
      if (!editor.id) setPeopleBoard(null);
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
      setPeopleBoard(null);
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

  const selectWorkflow = (id: string) => {
    setMode('people');
    setEditor(null);
    setEditorError('');
    setPersonMenu(null);
    if (id !== selectedBoard) {
      setPeopleBoard(null);
      setSelectedBoard(id);
    }
  };

  const startNewWorkflow = () => {
    setMode('people');
    setPersonMenu(null);
    setEditorError('');
    setEditor({ name: '', stages: [
      { id: '', name: 'Reach out' },
      { id: '', name: 'Follow up' },
      { id: '', name: 'Meeting' },
    ] });
  };

  if (!board) return null;
  const anyDeals = board.columns.some((column) => column.deals.length) || board.won.length || board.lost.length;
  const selectedTemplate = templates.find((template) => template.id === selectedBoard);

  return (
    <>
      <div className="toolbar board-switcher">
        <div className="board-nav-tools">
          <BoardPicker
            mode={mode}
            templates={templates}
            selectedBoard={selectedBoard}
            onSelectWorkflow={selectWorkflow}
            onSelectDeals={() => { setMode('deals'); setEditor(null); setPersonMenu(null); }}
          />
          {mode === 'people' && (
            <button
              className="board-tool-button"
              onClick={() => {
                if (selectedTemplate) setEditor({ id: selectedTemplate.id, name: selectedTemplate.name, stages: selectedTemplate.stages.map((stage) => ({ ...stage })) });
              }}
              aria-label="Edit current workflow"
              title="Edit current workflow"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11.8-.5 2.1 2.1-.5L13.2 4.8 11.2 2.8zM9.9 4.1l2 2" /></svg>
            </button>
          )}
          <button className="board-new-button" onClick={startNewWorkflow}>
            <span aria-hidden="true">＋</span> New workflow
          </button>
        </div>
        <span className="board-mode-note">
          {mode === 'people' ? `${templates.length} ${templates.length === 1 ? 'workflow' : 'workflows'} · drag a person to move them forward.` : 'Deal value by sales stage.'}
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

      {mode === 'people' && !peopleBoard ? (
        <div className="board-loading" role="status">
          <span className="board-loading-route" aria-hidden="true"><i /><i /><i /></span>
          <span>Opening {selectedTemplate?.name ?? 'workflow'}…</span>
        </div>
      ) : mode === 'people' && peopleBoard ? (
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
                      onMenu={(x, y) => openPersonMenu(person, x, y)}
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
      {personMenu && mode === 'people' && (
        <div
          className="person-context-menu"
          role="menu"
          aria-label={`Actions for ${personMenu.person.name}`}
          style={{ left: personMenu.x, top: personMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="person-context-name">
            <span>Workflow contact</span>
            <strong>{personMenu.person.name}</strong>
          </div>
          <button
            type="button"
            className="person-context-remove"
            role="menuitem"
            disabled={personMenuBusy}
            onClick={() => void removePersonFromFlow()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M8 3l-5 5 5 5" />
            </svg>
            <span>
              <strong>{personMenuBusy ? 'Removing…' : 'Remove from flow'}</strong>
              <small>Keep the contact in People</small>
            </span>
          </button>
        </div>
      )}
    </>
  );
}

function BoardPicker({ mode, templates, selectedBoard, onSelectWorkflow, onSelectDeals }: {
  mode: BoardMode;
  templates: PeopleBoardTemplate[];
  selectedBoard: string;
  onSelectWorkflow: (id: string) => void;
  onSelectDeals: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const current = templates.find((template) => template.id === selectedBoard);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="board-picker" ref={pickerRef}>
      <button
        type="button"
        className="board-picker-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className={`board-picker-mark ${mode}`} aria-hidden="true">
          {mode === 'people' ? (
            <svg viewBox="0 0 24 24"><circle cx="5" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" /><path d="M6.8 7.2 10.3 10.7M13.7 13.3l3.5 3.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M5 18V9M12 18V5M19 18v-6" /><path d="M2.5 18.5h19" /></svg>
          )}
        </span>
        <span className="board-picker-copy">
          <small>{mode === 'people' ? 'People workflow' : 'Sales board'}</small>
          <strong>{mode === 'people' ? current?.name ?? 'Choose workflow' : 'Deals'}</strong>
        </span>
        <svg className="board-picker-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>

      {open && (
        <div className="board-picker-menu" role="menu" aria-label="Choose a board">
          <div className="board-picker-heading">
            <span>People workflows</span>
            <small>{templates.length}</small>
          </div>
          <div className="board-picker-options">
            {templates.map((template) => {
              const active = mode === 'people' && template.id === selectedBoard;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={active ? 'board-picker-option is-active' : 'board-picker-option'}
                  key={template.id}
                  onClick={() => { onSelectWorkflow(template.id); setOpen(false); }}
                >
                  <span className="board-option-route" aria-hidden="true"><i /><i /><i /></span>
                  <span className="board-option-copy">
                    <strong>{template.name}</strong>
                    <small>{template.stages.length} {template.stages.length === 1 ? 'stage' : 'stages'}</small>
                  </span>
                  {active && <span className="board-option-check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="board-picker-divider" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={mode === 'deals'}
            className={mode === 'deals' ? 'board-picker-option deals is-active' : 'board-picker-option deals'}
            onClick={() => { onSelectDeals(); setOpen(false); }}
          >
            <span className="board-option-deals" aria-hidden="true">◆</span>
            <span className="board-option-copy"><strong>Deals</strong><small>Sales pipeline</small></span>
            {mode === 'deals' && <span className="board-option-check" aria-hidden="true">✓</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function PersonStageCard({ person, stageName, dragging, onDragStart, onDragEnd, onOpen, onMenu }: {
  person: PersonBoardCard;
  stageName: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const suppressOpen = useRef(false);
  return (
    <article
      className={dragging ? 'deal person-stage-card is-dragging' : 'deal person-stage-card'}
      draggable
      onDragStart={(event) => { suppressOpen.current = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', person.id); onDragStart(); }}
      onDragEnd={() => { onDragEnd(); window.setTimeout(() => { suppressOpen.current = false; }, 0); }}
      onClick={() => { if (!suppressOpen.current) onOpen(); }}
      onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          onMenu(bounds.left + 22, bounds.top + 22);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${person.name}, ${stageName}`}
      title="Right-click for workflow actions"
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

function removeCard(board: PersonBoard, personId: string): PersonBoard {
  const found = board.columns.some((column) => column.people.some((person) => person.id === personId));
  if (!found) return board;
  const columns = board.columns.map((column) => {
    const people = column.people.filter((person) => person.id !== personId);
    return { ...column, people, count: people.length };
  });
  return { ...board, columns, total: Math.max(0, board.total - 1) };
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

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
  const dropStage = (target: number) => {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const stages = [...draft.stages];
    const [moved] = stages.splice(dragIndex, 1);
    stages.splice(target, 0, moved);
    onChange({ ...draft, stages });
    setDragIndex(null);
    setDropIndex(null);
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
      <div className="board-editor-label"><span>Columns</span><small>Grab a row to change the workflow order.</small></div>
      <div className="board-column-editor">
        {draft.stages.map((stage, index) => {
          const occupied = Boolean(stage.id && counts[stage.id]);
          return (
            <div
              className={`board-column-row${dragIndex === index ? ' is-dragging' : ''}${dropIndex === index && dragIndex !== index ? ' is-drop-target' : ''}`}
              key={`${stage.id || 'new'}-${index}`}
              onDragEnter={(event) => { if (dragIndex !== null) { event.preventDefault(); setDropIndex(index); } }}
              onDragOver={(event) => { if (dragIndex !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(event) => { event.preventDefault(); dropStage(index); }}
            >
              <button
                type="button"
                className="board-column-grab"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-pigeon-board-stage', String(index));
                  setDragIndex(index);
                  setDropIndex(index);
                }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                aria-label={`Drag ${stage.name || `column ${index + 1}`} to reorder`}
                title="Drag to reorder"
              >
                ⠿
              </button>
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
