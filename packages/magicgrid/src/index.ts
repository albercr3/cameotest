export {
  MAGICGRID_VERSION,
  alignmentConstraintSchema,
  constraintSchema,
  constraintStrengthSchema,
  gridElementSchema,
  layoutMetadataSchema,
  lockConstraintSchema,
  magicGridManifestSchema,
  magicGridWorkspaceSchema,
  paddingSchema,
  spacingConstraintSchema,
  viewportSchema,
  validateMagicGridWorkspace,
} from './ir.js';

export type {
  ConstraintStrength,
  GridElement,
  LayoutMetadata,
  MagicGridConstraint,
  MagicGridManifest,
  MagicGridWorkspace,
  MagicGridWorkspaceInput,
  Padding,
  Viewport,
} from './ir.js';

export {
  createElement,
  defaultConstraints,
  defaultGridElements,
  defaultLayoutMetadata,
  defaultMagicGridWorkspace,
  defaultManifest,
} from './defaults.js';
