import type { Element, Metaclass } from '@cameotest/shared';

interface PropertiesPanelProps {
  element?: Element;
  metaclasses: Metaclass[];
  onChange: (updates: Partial<Element>) => void;
}

export function PropertiesPanel({ element, metaclasses, onChange }: PropertiesPanelProps) {
  if (!element) {
    return <p className="muted">Select an element to inspect its properties.</p>;
  }

  return (
    <form className="properties" onSubmit={(event) => event.preventDefault()}>
      <label className="label" htmlFor="prop-name">
        Name
      </label>
      <input
        id="prop-name"
        value={element.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />

      <label className="label" htmlFor="prop-metaclass">
        Metaclass
      </label>
      <select
        id="prop-metaclass"
        value={element.metaclass}
        onChange={(event) => onChange({ metaclass: event.target.value as Metaclass })}
      >
        {metaclasses.map((mc) => (
          <option key={mc} value={mc}>
            {mc}
          </option>
        ))}
      </select>

      <label className="label" htmlFor="prop-doc">
        Documentation
      </label>
      <textarea
        id="prop-doc"
        value={element.documentation}
        onChange={(event) => onChange({ documentation: event.target.value })}
        rows={4}
      />

      <label className="label" htmlFor="prop-stereotypes">
        Stereotypes (comma separated)
      </label>
      <input
        id="prop-stereotypes"
        value={element.stereotypes.join(', ')}
        onChange={(event) =>
          onChange({ stereotypes: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
        }
      />

      <label className="label" htmlFor="prop-tags">
        Tags (key=value, comma separated)
      </label>
      <input
        id="prop-tags"
        value={Object.entries(element.tags)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')}
        onChange={(event) => {
          const next = event.target.value
            .split(',')
            .map((pair) => pair.trim())
            .filter(Boolean)
            .reduce<Record<string, string>>((acc, pair) => {
              const [key, value] = pair.split('=');
              if (key && value) acc[key.trim()] = value.trim();
              return acc;
            }, {});
          onChange({ tags: next });
        }}
      />
    </form>
  );
}
