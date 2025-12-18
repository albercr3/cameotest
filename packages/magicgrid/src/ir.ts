import { z } from 'zod';

export const MAGICGRID_VERSION = '0.1.0';

export const magicGridManifestSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    description: z.string().default(''),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    schemaVersion: z.string().default(MAGICGRID_VERSION),
    tags: z.record(z.string()).default({}),
  })
  .passthrough();
export type MagicGridManifest = z.infer<typeof magicGridManifestSchema>;

export const gridElementSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    rowSpan: z.number().int().positive().default(1),
    columnSpan: z.number().int().positive().default(1),
    minWidth: z.number().nonnegative().optional(),
    minHeight: z.number().nonnegative().optional(),
    maxWidth: z.number().positive().optional(),
    maxHeight: z.number().positive().optional(),
    layer: z.enum(['background', 'content', 'overlay']).default('content'),
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
    data: z.record(z.any()).default({}),
    tags: z.record(z.string()).default({}),
    notes: z.string().default(''),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
export type GridElement = z.infer<typeof gridElementSchema>;

export const constraintStrengthSchema = z.enum(['required', 'strong', 'weak']);
export type ConstraintStrength = z.infer<typeof constraintStrengthSchema>;

const baseConstraintSchema = z
  .object({
    id: z.string().uuid(),
    appliesTo: z.array(z.string().uuid()).min(1),
    label: z.string().default(''),
    strength: constraintStrengthSchema.default('strong'),
  })
  .passthrough();

export const alignmentConstraintSchema = baseConstraintSchema.extend({
  kind: z.literal('alignment'),
  axis: z.enum(['row', 'column']),
  track: z.number().int().nonnegative(),
});

export const spacingConstraintSchema = baseConstraintSchema.extend({
  kind: z.literal('spacing'),
  axis: z.enum(['row', 'column']),
  gap: z.number().nonnegative(),
});

export const lockConstraintSchema = baseConstraintSchema.extend({
  kind: z.literal('lock'),
  anchor: z.enum(['viewport', 'padding']).default('padding'),
  offset: z
    .object({
      top: z.number().default(0),
      right: z.number().default(0),
      bottom: z.number().default(0),
      left: z.number().default(0),
    })
    .default({ top: 0, right: 0, bottom: 0, left: 0 }),
});

export const constraintSchema = z.discriminatedUnion('kind', [
  alignmentConstraintSchema,
  spacingConstraintSchema,
  lockConstraintSchema,
]);
export type MagicGridConstraint = z.infer<typeof constraintSchema>;

export const paddingSchema = z
  .object({
    top: z.number().nonnegative().default(16),
    right: z.number().nonnegative().default(16),
    bottom: z.number().nonnegative().default(16),
    left: z.number().nonnegative().default(16),
  })
  .passthrough();
export type Padding = z.infer<typeof paddingSchema>;

export const viewportSchema = z
  .object({
    zoom: z.number().positive().default(1),
    panX: z.number().default(0),
    panY: z.number().default(0),
    snapToGrid: z.boolean().default(true),
    gridVisible: z.boolean().default(true),
  })
  .passthrough();
export type Viewport = z.infer<typeof viewportSchema>;

export const layoutMetadataSchema = z
  .object({
    rows: z.number().int().positive().default(12),
    columns: z.number().int().positive().default(12),
    rowGap: z.number().nonnegative().default(8),
    columnGap: z.number().nonnegative().default(8),
    padding: paddingSchema.default({ top: 16, right: 16, bottom: 16, left: 16 }),
    viewport: viewportSchema.default({ zoom: 1, panX: 0, panY: 0, snapToGrid: true, gridVisible: true }),
    trackSizes: z
      .object({
        rows: z.array(z.number().positive()).default([]),
        columns: z.array(z.number().positive()).default([]),
      })
      .default({ rows: [], columns: [] }),
    background: z
      .object({
        color: z.string().default('#ffffff'),
        pattern: z.enum(['none', 'grid']).default('grid'),
      })
      .default({ color: '#ffffff', pattern: 'grid' }),
  })
  .passthrough();
export type LayoutMetadata = z.infer<typeof layoutMetadataSchema>;

export const magicGridWorkspaceSchema = z
  .object({
    manifest: magicGridManifestSchema,
    layout: layoutMetadataSchema,
    elements: z.array(gridElementSchema),
    constraints: z.array(constraintSchema).default([]),
  })
  .passthrough();
export type MagicGridWorkspace = z.infer<typeof magicGridWorkspaceSchema>;
export type MagicGridWorkspaceInput = z.input<typeof magicGridWorkspaceSchema>;

export function validateMagicGridWorkspace(workspace: MagicGridWorkspaceInput) {
  const parsed = magicGridWorkspaceSchema.safeParse(workspace);
  if (!parsed.success) {
    throw new Error(`Invalid magicgrid workspace: ${parsed.error.message}`);
  }
  return parsed.data;
}
