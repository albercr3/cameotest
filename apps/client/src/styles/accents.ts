export function accentForMetaclass(metaclass?: string) {
  switch (metaclass) {
    case 'Block':
      return 'var(--accent-block)';
    case 'Part':
      return 'var(--accent-part)';
    case 'Port':
      return 'var(--accent-port)';
    case 'Signal':
      return 'var(--accent-signal)';
    case 'Package':
      return 'var(--accent-package)';
    case 'Diagram':
      return '#0ea5e9';
    default:
      return 'var(--color-primary)';
  }
}
