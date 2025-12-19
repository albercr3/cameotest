import { useEffect, useMemo, useState } from 'react';
import type { GridElement, MagicGridConstraint } from '@cameotest/magicgrid';

type ConstraintDraft = {
  kind: MagicGridConstraint['kind'];
  label: string;
  strength: MagicGridConstraint['strength'];
  axis?: 'row' | 'column';
  track?: number;
  gap?: number;
  anchor?: 'viewport' | 'padding';
  offset?: { top: number; right: number; bottom: number; left: number };
  appliesTo: string[];
};

const DEFAULT_OFFSET: ConstraintDraft['offset'] = { top: 0, right: 0, bottom: 0, left: 0 };

function createDraft(kind: MagicGridConstraint['kind'], appliesTo: string[]): ConstraintDraft {
  return {
    kind,
    label: '',
    strength: 'strong',
    axis: 'row',
    track: 0,
    gap: 0,
    anchor: 'padding',
    offset: DEFAULT_OFFSET,
    appliesTo,
  };
}

export type MagicGridConstraintDraft = ConstraintDraft;

interface MagicGridConstraintsProps {
  constraints: MagicGridConstraint[];
  elements: GridElement[];
  selectedElementId: string | null;
  onAddConstraint: (constraint: MagicGridConstraintDraft) => void;
  onUpdateConstraint: (id: string, updates: Partial<MagicGridConstraint>) => void;
  onDeleteConstraint: (id: string) => void;
}

export function MagicGridConstraints({
  constraints,
  elements,
  selectedElementId,
  onAddConstraint,
  onUpdateConstraint,
  onDeleteConstraint,
}: MagicGridConstraintsProps) {
  const defaultAppliesTo = useMemo(() => {
    if (selectedElementId) return [selectedElementId];
    return elements.length ? [elements[0].id] : [];
  }, [elements, selectedElementId]);

  const [draft, setDraft] = useState<ConstraintDraft>(() => createDraft('alignment', defaultAppliesTo));

  useEffect(() => {
    setDraft((current) =>
      current.appliesTo.length
        ? current
        : {
            ...current,
            appliesTo: defaultAppliesTo,
          },
    );
  }, [defaultAppliesTo]);

  function handleDraftChange(partial: Partial<ConstraintDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function handleDraftKindChange(kind: MagicGridConstraint['kind']) {
    setDraft(createDraft(kind, draft.appliesTo.length ? draft.appliesTo : defaultAppliesTo));
  }

  function handleToggleAppliesTo(targetId: string) {
    setDraft((current) => {
      const includes = current.appliesTo.includes(targetId);
      const appliesTo = includes ? current.appliesTo.filter((id) => id !== targetId) : [...current.appliesTo, targetId];
      return { ...current, appliesTo };
    });
  }

  function handleSubmitDraft() {
    onAddConstraint(draft);
    setDraft(createDraft(draft.kind, defaultAppliesTo));
  }

  function toggleConstraintAppliesTo(constraint: MagicGridConstraint, targetId: string) {
    const includes = constraint.appliesTo.includes(targetId);
    const appliesTo = includes
      ? constraint.appliesTo.filter((id) => id !== targetId)
      : [...constraint.appliesTo, targetId];
    if (!appliesTo.length) return;
    onUpdateConstraint(constraint.id, { appliesTo });
  }

  function renderKindSpecificFields(constraint: MagicGridConstraint) {
    switch (constraint.kind) {
      case 'alignment':
        return (
          <>
            <label>
              <span>Axis</span>
              <select
                value={constraint.axis}
                onChange={(event) => onUpdateConstraint(constraint.id, { axis: event.target.value as 'row' | 'column' })}
              >
                <option value="row">row</option>
                <option value="column">column</option>
              </select>
            </label>
            <label>
              <span>Track</span>
              <input
                type="number"
                min={0}
                value={constraint.track}
                onChange={(event) => onUpdateConstraint(constraint.id, { track: Number(event.target.value) })}
              />
            </label>
          </>
        );
      case 'spacing':
        return (
          <>
            <label>
              <span>Axis</span>
              <select
                value={constraint.axis}
                onChange={(event) => onUpdateConstraint(constraint.id, { axis: event.target.value as 'row' | 'column' })}
              >
                <option value="row">row</option>
                <option value="column">column</option>
              </select>
            </label>
            <label>
              <span>Gap</span>
              <input
                type="number"
                min={0}
                value={constraint.gap}
                onChange={(event) => onUpdateConstraint(constraint.id, { gap: Number(event.target.value) })}
              />
            </label>
          </>
        );
      case 'lock':
        return (
          <>
            <label>
              <span>Anchor</span>
              <select
                value={constraint.anchor}
                onChange={(event) => onUpdateConstraint(constraint.id, { anchor: event.target.value as 'viewport' | 'padding' })}
              >
                <option value="padding">padding</option>
                <option value="viewport">viewport</option>
              </select>
            </label>
            <div className="magicgrid-properties__grid">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <label key={side}>
                  <span>{side} offset</span>
                  <input
                    type="number"
                    value={constraint.offset?.[side] ?? 0}
                    onChange={(event) =>
                      onUpdateConstraint(constraint.id, {
                        offset: { ...(constraint.offset ?? DEFAULT_OFFSET), [side]: Number(event.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </>
        );
      default:
        return null;
    }
  }

  function renderDraftFields() {
    if (draft.kind === 'alignment') {
      return (
        <>
          <label>
            <span>Axis</span>
            <select value={draft.axis} onChange={(event) => handleDraftChange({ axis: event.target.value as 'row' | 'column' })}>
              <option value="row">row</option>
              <option value="column">column</option>
            </select>
          </label>
          <label>
            <span>Track</span>
            <input
              type="number"
              min={0}
              value={draft.track}
              onChange={(event) => handleDraftChange({ track: Number(event.target.value) })}
            />
          </label>
        </>
      );
    }

    if (draft.kind === 'spacing') {
      return (
        <>
          <label>
            <span>Axis</span>
            <select value={draft.axis} onChange={(event) => handleDraftChange({ axis: event.target.value as 'row' | 'column' })}>
              <option value="row">row</option>
              <option value="column">column</option>
            </select>
          </label>
          <label>
            <span>Gap</span>
            <input
              type="number"
              min={0}
              value={draft.gap}
              onChange={(event) => handleDraftChange({ gap: Number(event.target.value) })}
            />
          </label>
        </>
      );
    }

    return (
      <>
        <label>
          <span>Anchor</span>
          <select
            value={draft.anchor}
            onChange={(event) => handleDraftChange({ anchor: event.target.value as 'viewport' | 'padding' })}
          >
            <option value="padding">padding</option>
            <option value="viewport">viewport</option>
          </select>
        </label>
        <div className="magicgrid-properties__grid">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side}>
              <span>{side} offset</span>
              <input
                type="number"
                value={draft.offset?.[side] ?? 0}
                onChange={(event) =>
                  handleDraftChange({ offset: { ...draft.offset, [side]: Number(event.target.value) } })
                }
              />
            </label>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="magicgrid-constraints">
      <div className="magicgrid__constraint magicgrid__constraint--builder">
        <div className="magicgrid-constraints__header">
          <label>
            <span>Kind</span>
            <select value={draft.kind} onChange={(event) => handleDraftKindChange(event.target.value as MagicGridConstraint['kind'])}>
              <option value="alignment">alignment</option>
              <option value="spacing">spacing</option>
              <option value="lock">lock</option>
            </select>
          </label>
          <label>
            <span>Label</span>
            <input type="text" value={draft.label} onChange={(event) => handleDraftChange({ label: event.target.value })} />
          </label>
          <label>
            <span>Strength</span>
            <select
              value={draft.strength}
              onChange={(event) => handleDraftChange({ strength: event.target.value as MagicGridConstraint['strength'] })}
            >
              <option value="required">required</option>
              <option value="strong">strong</option>
              <option value="weak">weak</option>
            </select>
          </label>
        </div>
        <div className="magicgrid-constraints__fields">{renderDraftFields()}</div>
        <div className="magicgrid-constraints__applies">
          <span>Applies to</span>
          <div className="magicgrid-constraints__applies-list">
            {elements.map((item) => (
              <label key={item.id} className="magicgrid-properties__checkbox">
                <input
                  type="checkbox"
                  checked={draft.appliesTo.includes(item.id)}
                  onChange={() => handleToggleAppliesTo(item.id)}
                />
                <span>{item.title}</span>
              </label>
            ))}
            {elements.length === 0 ? <p className="magicgrid-properties__empty">Add elements to create constraints.</p> : null}
          </div>
        </div>
        <div className="magicgrid-properties__footer">
          <button className="button" type="button" onClick={handleSubmitDraft} disabled={!draft.appliesTo.length}>
            Add constraint
          </button>
        </div>
      </div>
      <div className="magicgrid__constraints">
        {constraints.map((constraint) => (
          <div key={constraint.id} className="magicgrid__constraint">
            <div className="magicgrid-constraints__header">
              <div>
                <div className="magicgrid__constraint-title">{constraint.label || constraint.kind}</div>
                <div className="magicgrid__constraint-meta">
                  <span>{constraint.kind}</span>
                  <span>{constraint.strength}</span>
                </div>
              </div>
              <button className="button button--ghost" type="button" onClick={() => onDeleteConstraint(constraint.id)}>
                Delete
              </button>
            </div>
            <div className="magicgrid-constraints__grid">
              <label>
                <span>Label</span>
                <input
                  type="text"
                  value={constraint.label}
                  onChange={(event) => onUpdateConstraint(constraint.id, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Strength</span>
                <select
                  value={constraint.strength}
                  onChange={(event) =>
                    onUpdateConstraint(constraint.id, { strength: event.target.value as MagicGridConstraint['strength'] })
                  }
                >
                  <option value="required">required</option>
                  <option value="strong">strong</option>
                  <option value="weak">weak</option>
                </select>
              </label>
            </div>
            <div className="magicgrid-constraints__fields">{renderKindSpecificFields(constraint)}</div>
            <div className="magicgrid-constraints__applies">
              <span>Applies to</span>
              <div className="magicgrid-constraints__applies-list">
                {elements.map((item) => (
                  <label key={item.id} className="magicgrid-properties__checkbox">
                    <input
                      type="checkbox"
                      checked={constraint.appliesTo.includes(item.id)}
                      onChange={() => toggleConstraintAppliesTo(constraint, item.id)}
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
        {constraints.length === 0 ? <p className="magicgrid-properties__empty">No constraints yet.</p> : null}
      </div>
    </div>
  );
}
