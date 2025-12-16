export function accentForMetaclass(metaclass?: string) {
  switch (metaclass) {
    case 'Block':
      return 'var(--accent-block)';
    case 'Part':
      return 'var(--accent-part)';
    case 'Port':
      return 'var(--accent-port)';
    case 'Package':
      return 'var(--accent-package)';
    default:
      return 'var(--color-primary)';
  }
}
