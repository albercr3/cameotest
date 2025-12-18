import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

import {
  DiagramsFile,
  ModelFile,
  WorkspaceFiles,
  WorkspaceManifest,
  diagramsFileSchema,
  parseSysmlPayload,
  modelFileSchema,
  workspaceToSysmlV2Json,
  workspaceToSysmlV2Text,
  IR_VERSION,
  validateWorkspace,
  validateWorkspaceFiles,
  workspaceManifestSchema,
} from '@cameotest/shared';

import { attachUser, requireUser, requireWorkspacePermission } from './auth.js';
import { FileWorkspaceRepository, VersionConflictError } from './workspaceRepository.js';

const app = express();
const port = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseWorkspacesDir =
  process.env.WORKSPACE_STORAGE_DIR ?? path.resolve(__dirname, '../../../data/workspaces');
const legacyWorkspacesDir = path.resolve(__dirname, '../../../examples/workspaces');

const repository = new FileWorkspaceRepository({ baseDir: baseWorkspacesDir, legacyDir: legacyWorkspacesDir });
await repository.bootstrapLegacyWorkspaces();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(attachUser());

let currentWorkspaceId: string | null = null;

function normalizeDiagrams(diagrams: DiagramsFile | undefined): DiagramsFile {
  if (!diagrams) return { diagrams: [] };
  const normalized = diagrams.diagrams.map((diagram) => ({
    ...diagram,
    kind: diagram.kind ?? diagram.type,
    type: diagram.type ?? diagram.kind,
  }));
  return { diagrams: normalized } satisfies DiagramsFile;
}

function ensureWorkspaceValid(candidate: WorkspaceFiles) {
  const validation = validateWorkspace(candidate);
  if (validation.issues.length > 0) {
    return { ok: false as const, validation } as const;
  }
  return { ok: true as const } as const;
}

function manifestFromSysml(sysmlManifest?: Partial<WorkspaceManifest>): WorkspaceManifest {
  const now = new Date().toISOString();
  return workspaceManifestSchema.parse({
    id: sysmlManifest?.id ?? 'sysmlv2-import',
    name: sysmlManifest?.name ?? sysmlManifest?.id ?? 'Imported SysML v2 workspace',
    description: sysmlManifest?.description ?? 'Imported from SysML v2 JSON',
    createdAt: sysmlManifest?.createdAt ?? now,
    updatedAt: now,
    version: sysmlManifest?.version ?? 1,
  });
}

function schemaVersionFromQuery(query: Record<string, unknown>): string {
  return (typeof query.schema === 'string' && query.schema) ||
    (typeof query.version === 'string' && query.version) ||
    IR_VERSION;
}

function starterWorkspace(manifest: WorkspaceManifest): WorkspaceFiles {
  const now = new Date().toISOString();
  const carBlockId = uuid();
  const engineBlockId = uuid();
  const transmissionBlockId = uuid();
  const wheelBlockId = uuid();
  const batteryBlockId = uuid();
  const brakeControllerBlockId = uuid();
  const sensorBlockId = uuid();

  const driverSignalId = uuid();
  const torqueSignalId = uuid();
  const brakeSignalId = uuid();

  const enginePartId = uuid();
  const transmissionPartId = uuid();
  const batteryPartId = uuid();
  const brakeControllerPartId = uuid();
  const sensorPartId = uuid();
  const wheelFrontLeftId = uuid();
  const wheelFrontRightId = uuid();
  const wheelRearLeftId = uuid();
  const wheelRearRightId = uuid();

  const carDriverPortId = uuid();
  const carTelemetryPortId = uuid();
  const enginePowerInPortId = uuid();
  const engineTorqueOutPortId = uuid();
  const transmissionTorqueInPortId = uuid();
  const transmissionAxleOutPortId = uuid();
  const batteryPowerOutPortId = uuid();
  const brakeCommandInPortId = uuid();
  const brakeHydraulicOutPortId = uuid();
  const wheelTorqueInPortId = uuid();
  const wheelSpeedOutPortId = uuid();

  const elements: ModelFile['elements'] = [
    {
      id: carBlockId,
      metaclass: 'Block',
      name: 'CarSystem',
      ownerId: null,
      documentation: 'Reference block representing a modern vehicle.',
      stereotypes: [],
      tags: {},
      createdAt: now,
      updatedAt: now,
    },
    { id: engineBlockId, metaclass: 'Block', name: 'Engine', ownerId: carBlockId, documentation: 'Combustion or electric drive unit.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: transmissionBlockId, metaclass: 'Block', name: 'Transmission', ownerId: carBlockId, documentation: 'Distributes torque to the axles.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelBlockId, metaclass: 'Block', name: 'WheelAssembly', ownerId: carBlockId, documentation: 'Hub, tire, and brake assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: batteryBlockId, metaclass: 'Block', name: 'BatteryPack', ownerId: carBlockId, documentation: 'Energy storage feeding the power bus.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: brakeControllerBlockId, metaclass: 'Block', name: 'BrakeController', ownerId: carBlockId, documentation: 'Supervises braking and stability.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: sensorBlockId, metaclass: 'Block', name: 'SensorHub', ownerId: carBlockId, documentation: 'Aggregates speed and chassis telemetry.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: driverSignalId, metaclass: 'Signal', name: 'DriverCommand', ownerId: carBlockId, documentation: 'Commanded acceleration and brake request.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: torqueSignalId, metaclass: 'Signal', name: 'DriveTorque', ownerId: carBlockId, documentation: 'Torque delivered to the axle.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: brakeSignalId, metaclass: 'Signal', name: 'BrakeHydraulics', ownerId: carBlockId, documentation: 'Hydraulic pressure for wheel brakes.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: enginePartId, metaclass: 'Part', name: 'engine', ownerId: carBlockId, typeId: engineBlockId, documentation: 'Installed engine assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: transmissionPartId, metaclass: 'Part', name: 'gearbox', ownerId: carBlockId, typeId: transmissionBlockId, documentation: 'Transmission connected to the engine.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: batteryPartId, metaclass: 'Part', name: 'battery', ownerId: carBlockId, typeId: batteryBlockId, documentation: 'High-voltage pack.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: brakeControllerPartId, metaclass: 'Part', name: 'brakeController', ownerId: carBlockId, typeId: brakeControllerBlockId, documentation: 'Controls braking force.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: sensorPartId, metaclass: 'Part', name: 'sensors', ownerId: carBlockId, typeId: sensorBlockId, documentation: 'Wheel speed and chassis sensors.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelFrontLeftId, metaclass: 'Part', name: 'frontLeftWheel', ownerId: carBlockId, typeId: wheelBlockId, documentation: 'Front left wheel assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelFrontRightId, metaclass: 'Part', name: 'frontRightWheel', ownerId: carBlockId, typeId: wheelBlockId, documentation: 'Front right wheel assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelRearLeftId, metaclass: 'Part', name: 'rearLeftWheel', ownerId: carBlockId, typeId: wheelBlockId, documentation: 'Rear left wheel assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelRearRightId, metaclass: 'Part', name: 'rearRightWheel', ownerId: carBlockId, typeId: wheelBlockId, documentation: 'Rear right wheel assembly.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: carDriverPortId, metaclass: 'Port', name: 'driverInput', ownerId: carBlockId, direction: 'in', signalTypeId: driverSignalId, documentation: 'Acceleration and brake request.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: carTelemetryPortId, metaclass: 'Port', name: 'telemetry', ownerId: carBlockId, direction: 'out', signalTypeId: torqueSignalId, documentation: 'Aggregated wheel torque feedback.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: enginePowerInPortId, metaclass: 'Port', name: 'powerIn', ownerId: enginePartId, direction: 'in', signalTypeId: driverSignalId, documentation: 'Power bus feed.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: engineTorqueOutPortId, metaclass: 'Port', name: 'torqueOut', ownerId: enginePartId, direction: 'out', signalTypeId: torqueSignalId, documentation: 'Torque delivered to transmission.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: transmissionTorqueInPortId, metaclass: 'Port', name: 'torqueIn', ownerId: transmissionPartId, direction: 'in', signalTypeId: torqueSignalId, documentation: 'Input from the engine.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: transmissionAxleOutPortId, metaclass: 'Port', name: 'axleOut', ownerId: transmissionPartId, direction: 'out', signalTypeId: torqueSignalId, documentation: 'Output torque to wheels.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: batteryPowerOutPortId, metaclass: 'Port', name: 'dcOut', ownerId: batteryPartId, direction: 'out', signalTypeId: driverSignalId, documentation: 'Battery power delivery.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: brakeCommandInPortId, metaclass: 'Port', name: 'brakeIn', ownerId: brakeControllerPartId, direction: 'in', signalTypeId: driverSignalId, documentation: 'Requested brake level.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: brakeHydraulicOutPortId, metaclass: 'Port', name: 'brakeHydraulics', ownerId: brakeControllerPartId, direction: 'out', signalTypeId: brakeSignalId, documentation: 'Hydraulic pressure to wheels.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelTorqueInPortId, metaclass: 'Port', name: 'torqueIn', ownerId: wheelRearLeftId, direction: 'in', signalTypeId: torqueSignalId, documentation: 'Torque entering the wheel.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
    { id: wheelSpeedOutPortId, metaclass: 'Port', name: 'wheelSpeed', ownerId: sensorPartId, direction: 'out', signalTypeId: torqueSignalId, documentation: 'Measured wheel speed.', stereotypes: [], tags: {}, createdAt: now, updatedAt: now },
  ];

  const associationTo = (targetId: string) => ({
    id: uuid(),
    type: 'Association' as const,
    sourceId: carBlockId,
    targetId,
    properties: { kind: 'composition' },
  });

  const powerConnectorId = uuid();
  const torqueConnectorId = uuid();
  const brakeConnectorId = uuid();
  const telemetryConnectorId = uuid();
  const driverCommandConnectorId = uuid();
  const axleConnectorId = uuid();

  const relationships: ModelFile['relationships'] = [
    associationTo(engineBlockId),
    associationTo(transmissionBlockId),
    associationTo(batteryBlockId),
    associationTo(brakeControllerBlockId),
    associationTo(sensorBlockId),
    associationTo(wheelBlockId),
    { id: powerConnectorId, type: 'Connector', sourcePortId: batteryPowerOutPortId, targetPortId: enginePowerInPortId, itemFlowLabel: 'power' },
    { id: torqueConnectorId, type: 'Connector', sourcePortId: engineTorqueOutPortId, targetPortId: transmissionTorqueInPortId, itemFlowLabel: 'torque' },
    { id: brakeConnectorId, type: 'Connector', sourcePortId: brakeHydraulicOutPortId, targetPortId: wheelTorqueInPortId, itemFlowLabel: 'brake pressure' },
    { id: telemetryConnectorId, type: 'Connector', sourcePortId: wheelSpeedOutPortId, targetPortId: carTelemetryPortId, itemFlowLabel: 'telemetry' },
    { id: driverCommandConnectorId, type: 'Connector', sourcePortId: carDriverPortId, targetPortId: brakeCommandInPortId, itemFlowLabel: 'driver command' },
    { id: axleConnectorId, type: 'Connector', sourcePortId: transmissionAxleOutPortId, targetPortId: wheelTorqueInPortId, itemFlowLabel: 'axle torque' },
  ];

  const bddDiagramId = uuid();
  const carNodeId = uuid();
  const engineNodeId = uuid();
  const transmissionNodeId = uuid();
  const batteryNodeId = uuid();
  const brakeNodeId = uuid();
  const sensorNodeId = uuid();
  const wheelNodeId = uuid();

  const bddDiagram: DiagramsFile['diagrams'][number] = {
    id: bddDiagramId,
    name: `${manifest.name} BDD`,
    kind: 'BDD',
    type: 'BDD',
    ownerId: carBlockId,
    nodes: [
      { id: carNodeId, elementId: carBlockId, kind: 'Element', x: 80, y: 120, w: 220, h: 140, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: engineNodeId, elementId: engineBlockId, kind: 'Element', x: 360, y: 80, w: 200, h: 120, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: transmissionNodeId, elementId: transmissionBlockId, kind: 'Element', x: 620, y: 120, w: 200, h: 120, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: batteryNodeId, elementId: batteryBlockId, kind: 'Element', x: 360, y: 240, w: 180, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: brakeNodeId, elementId: brakeControllerBlockId, kind: 'Element', x: 620, y: 260, w: 200, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: sensorNodeId, elementId: sensorBlockId, kind: 'Element', x: 880, y: 200, w: 180, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelNodeId, elementId: wheelBlockId, kind: 'Element', x: 880, y: 60, w: 180, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
    ],
    edges: relationships
      .filter((rel) => rel.type === 'Association')
      .map((rel) => ({
        id: uuid(),
        relationshipId: rel.id,
        sourceNodeId: carNodeId,
        targetNodeId:
          rel.targetId === engineBlockId
            ? engineNodeId
            : rel.targetId === transmissionBlockId
              ? transmissionNodeId
              : rel.targetId === batteryBlockId
                ? batteryNodeId
                : rel.targetId === brakeControllerBlockId
                  ? brakeNodeId
                  : rel.targetId === sensorBlockId
                    ? sensorNodeId
                    : wheelNodeId,
        routingPoints: [],
        label: 'composes',
      })),
    viewSettings: { gridEnabled: true, snapEnabled: false, zoom: 1, panX: 0, panY: 0 },
  } satisfies DiagramsFile['diagrams'][number];

  const ibdDiagramId = uuid();
  const enginePartNodeId = uuid();
  const transmissionPartNodeId = uuid();
  const batteryPartNodeId = uuid();
  const brakePartNodeId = uuid();
  const sensorPartNodeId = uuid();
  const wheelFrontLeftNodeId = uuid();
  const wheelFrontRightNodeId = uuid();
  const wheelRearLeftNodeId = uuid();
  const wheelRearRightNodeId = uuid();

  const carDriverPortNodeId = uuid();
  const carTelemetryPortNodeId = uuid();
  const enginePowerInPortNodeId = uuid();
  const engineTorqueOutPortNodeId = uuid();
  const transmissionTorqueInPortNodeId = uuid();
  const transmissionAxleOutPortNodeId = uuid();
  const batteryPowerOutPortNodeId = uuid();
  const brakeCommandInPortNodeId = uuid();
  const brakeHydraulicOutPortNodeId = uuid();
  const wheelTorqueInPortNodeId = uuid();
  const wheelSpeedOutPortNodeId = uuid();

  const ibdDiagram: DiagramsFile['diagrams'][number] = {
    id: ibdDiagramId,
    name: `${manifest.name} IBD`,
    kind: 'IBD',
    type: 'IBD',
    contextBlockId: carBlockId,
    ownerId: carBlockId,
    nodes: [
      { id: enginePartNodeId, elementId: enginePartId, kind: 'Part', x: 260, y: 200, w: 180, h: 120, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: transmissionPartNodeId, elementId: transmissionPartId, kind: 'Part', x: 500, y: 200, w: 180, h: 120, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: batteryPartNodeId, elementId: batteryPartId, kind: 'Part', x: 180, y: 360, w: 160, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: brakePartNodeId, elementId: brakeControllerPartId, kind: 'Part', x: 520, y: 360, w: 170, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: sensorPartNodeId, elementId: sensorPartId, kind: 'Part', x: 760, y: 360, w: 160, h: 110, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelFrontLeftNodeId, elementId: wheelFrontLeftId, kind: 'Part', x: 360, y: 80, w: 120, h: 90, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelFrontRightNodeId, elementId: wheelFrontRightId, kind: 'Part', x: 520, y: 80, w: 120, h: 90, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelRearLeftNodeId, elementId: wheelRearLeftId, kind: 'Part', x: 360, y: 520, w: 120, h: 90, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelRearRightNodeId, elementId: wheelRearRightId, kind: 'Part', x: 520, y: 520, w: 120, h: 90, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: carDriverPortNodeId, elementId: carDriverPortId, kind: 'Port', x: 240, y: 140, w: 28, h: 28, placement: { side: 'N', offset: 0.35 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: carTelemetryPortNodeId, elementId: carTelemetryPortId, kind: 'Port', x: 760, y: 140, w: 28, h: 28, placement: { side: 'N', offset: 0.7 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: enginePowerInPortNodeId, elementId: enginePowerInPortId, kind: 'Port', x: 260, y: 240, w: 24, h: 24, placement: { side: 'W', offset: 0.55 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: engineTorqueOutPortNodeId, elementId: engineTorqueOutPortId, kind: 'Port', x: 440, y: 260, w: 24, h: 24, placement: { side: 'E', offset: 0.55 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: transmissionTorqueInPortNodeId, elementId: transmissionTorqueInPortId, kind: 'Port', x: 500, y: 260, w: 24, h: 24, placement: { side: 'W', offset: 0.45 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: transmissionAxleOutPortNodeId, elementId: transmissionAxleOutPortId, kind: 'Port', x: 680, y: 254, w: 24, h: 24, placement: { side: 'E', offset: 0.45 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: batteryPowerOutPortNodeId, elementId: batteryPowerOutPortId, kind: 'Port', x: 340, y: 415, w: 24, h: 24, placement: { side: 'E', offset: 0.5 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: brakeCommandInPortNodeId, elementId: brakeCommandInPortId, kind: 'Port', x: 520, y: 404, w: 24, h: 24, placement: { side: 'W', offset: 0.4 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: brakeHydraulicOutPortNodeId, elementId: brakeHydraulicOutPortId, kind: 'Port', x: 690, y: 426, w: 24, h: 24, placement: { side: 'E', offset: 0.6 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelTorqueInPortNodeId, elementId: wheelTorqueInPortId, kind: 'Port', x: 360, y: 565, w: 24, h: 24, placement: { side: 'W', offset: 0.5 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
      { id: wheelSpeedOutPortNodeId, elementId: wheelSpeedOutPortId, kind: 'Port', x: 860, y: 415, w: 24, h: 24, placement: { side: 'E', offset: 0.5 }, compartments: { collapsed: false, showPorts: true, showParts: true }, style: { highlight: false } },
    ],
    edges: [
      { id: uuid(), relationshipId: powerConnectorId, sourceNodeId: batteryPowerOutPortNodeId, targetNodeId: enginePowerInPortNodeId, routingPoints: [], label: 'power' },
      { id: uuid(), relationshipId: torqueConnectorId, sourceNodeId: engineTorqueOutPortNodeId, targetNodeId: transmissionTorqueInPortNodeId, routingPoints: [], label: 'torque' },
      { id: uuid(), relationshipId: brakeConnectorId, sourceNodeId: brakeHydraulicOutPortNodeId, targetNodeId: wheelTorqueInPortNodeId, routingPoints: [], label: 'brake pressure' },
      { id: uuid(), relationshipId: telemetryConnectorId, sourceNodeId: wheelSpeedOutPortNodeId, targetNodeId: carTelemetryPortNodeId, routingPoints: [], label: 'telemetry' },
      { id: uuid(), relationshipId: driverCommandConnectorId, sourceNodeId: carDriverPortNodeId, targetNodeId: brakeCommandInPortNodeId, routingPoints: [], label: 'driver command' },
      { id: uuid(), relationshipId: axleConnectorId, sourceNodeId: transmissionAxleOutPortNodeId, targetNodeId: wheelTorqueInPortNodeId, routingPoints: [], label: 'axle' },
    ],
    viewSettings: { gridEnabled: true, snapEnabled: false, zoom: 0.9, panX: -20, panY: -20 },
  } satisfies DiagramsFile['diagrams'][number];

  return {
    manifest: { ...manifest, version: manifest.version ?? 1 },
    model: { elements, relationships },
    diagrams: { diagrams: [bddDiagram, ibdDiagram] },
  } satisfies WorkspaceFiles;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/workspaces', requireUser(), async (_req, res) => {
  const workspaces = await repository.listWorkspaces();
  res.json(workspaces);
});

app.post('/api/workspaces', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  const { id, name, description } = req.body as Partial<WorkspaceManifest>;
  if (!id || !name) {
    return res.status(400).json({ message: 'id and name are required' });
  }
  const now = new Date().toISOString();
  try {
    const manifest = workspaceManifestSchema.parse({
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    const created = await repository.createWorkspace(starterWorkspace(manifest), {
      ownerId: req.user?.id,
    });
    currentWorkspaceId = created.id;
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ message: 'Unable to create workspace', details: String(error) });
  }
});

app.delete(
  '/api/workspaces/:id',
  requireUser(),
  requireWorkspacePermission('delete'),
  async (req, res) => {
    const { id } = req.params;
    const removed = await repository.deleteWorkspace(id);
    if (!removed) {
      return res.status(404).json({ message: `Workspace ${id} not found` });
    }
    if (currentWorkspaceId === id) {
      currentWorkspaceId = null;
    }
    res.status(204).end();
  },
);

app.post('/api/workspaces/:id/open', requireUser(), async (req, res) => {
  const { id } = req.params;
  try {
    const manifest = await repository.getManifest(id);
    if (!manifest) throw new Error('not found');
    currentWorkspaceId = manifest.id;
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: `Workspace ${id} not found`, details: String(error) });
  }
});

app.get('/api/workspaces/current', requireUser(), async (_req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const manifest = await repository.getManifest(workspaceId);
    if (!manifest) throw new Error('Missing manifest');
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: 'Current workspace unavailable', details: String(error) });
  }
});

app.get('/api/workspaces/current/load', requireUser(), async (_req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const workspace = await repository.getWorkspace(currentWorkspaceId);
    if (!workspace) throw new Error('Workspace not found');
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load workspace', details: String(error) });
  }
});

app.get('/api/workspaces/current/export', requireUser(), async (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const workspace = await repository.getWorkspace(currentWorkspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const format = typeof req.query.type === 'string' ? req.query.type : undefined;
    const schemaVersion = schemaVersionFromQuery(req.query as Record<string, unknown>);
    if (format === 'sysmlv2-json') {
      const bundle = workspaceToSysmlV2Json(workspace, {
        schemaVersion,
        manifestOverride: workspace.manifest,
      });
      return res.json(bundle);
    }
    if (format === 'sysmlv2-text') {
      const bundle = workspaceToSysmlV2Text(workspace, {
        schemaVersion,
        manifestOverride: workspace.manifest,
      });
      return res.json(bundle);
    }
    if (format === 'workspace-json') {
      return res.json({ type: 'workspace-json', workspace });
    }
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ message: 'Failed to export workspace', details: String(error) });
  }
});

app.post('/api/workspaces/current/save', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const candidate = req.body as WorkspaceFiles;
    const validated = validateWorkspaceFiles(candidate);
    const expectedVersion = validated.manifest.version;
    const workspace: WorkspaceFiles = { ...validated, manifest: { ...validated.manifest, id: currentWorkspaceId } };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const manifest = await repository.saveWorkspace(workspace, expectedVersion, {
      ownerId: req.user?.id,
    });
    currentWorkspaceId = manifest.id;
    res.json({ status: 'saved', manifest });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return res.status(409).json({
        message: 'Workspace has been updated elsewhere',
        expected: error.expected,
        actual: error.actual,
      });
    }
    res.status(400).json({ message: 'Save failed', details: String(error) });
  }
});

app.post('/api/workspaces/current/import', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const existing = await repository.getWorkspace(workspaceId);
    if (!existing) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    const rawManifest =
      (req.body as { manifest?: Partial<WorkspaceManifest> }).manifest ??
      (req.body as { sysml?: { manifest?: Partial<WorkspaceManifest> } }).sysml?.manifest;
    const manifestOverride = {
      ...manifestFromSysml(rawManifest),
      id: existing.manifest.id,
      createdAt: existing.manifest.createdAt,
      version: existing.manifest.version,
    } satisfies WorkspaceManifest;
    const sysmlWorkspace = parseSysmlPayload(req.body, {
      manifestOverride: { ...manifestOverride, updatedAt: new Date().toISOString() },
    });

    if (sysmlWorkspace) {
      const workspace: WorkspaceFiles = {
        manifest: { ...sysmlWorkspace.manifest, id: existing.manifest.id },
        model: sysmlWorkspace.model,
        diagrams: normalizeDiagrams(sysmlWorkspace.diagrams),
      };
      const validity = ensureWorkspaceValid(workspace);
      if (!validity.ok) {
        return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
      }
      const savedManifest = await repository.saveWorkspace(workspace, existing.manifest.version, {
        ownerId: req.user?.id,
      });
      return res.json({ status: 'imported', manifest: savedManifest });
    }

    const body = req.body as Partial<WorkspaceFiles> & { model?: ModelFile };
    if (!body.model) {
      return res.status(400).json({ message: 'model payload is required' });
    }
    const model = modelFileSchema.parse(body.model);
    const manifest = { ...existing.manifest, updatedAt: new Date().toISOString() };
    const diagrams = existing.diagrams;
    const workspace: WorkspaceFiles = { manifest, model, diagrams };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const savedManifest = await repository.saveWorkspace(workspace, existing.manifest.version, {
      ownerId: req.user?.id,
    });
    res.json({ status: 'imported', manifest: savedManifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post('/api/workspaces/import', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  try {
    const rawManifest =
      (req.body as { manifest?: Partial<WorkspaceManifest> }).manifest ??
      (req.body as { sysml?: { manifest?: Partial<WorkspaceManifest> } }).sysml?.manifest;
    const sysmlWorkspace = parseSysmlPayload(req.body, {
      manifestOverride: manifestFromSysml(rawManifest),
    });

    if (sysmlWorkspace) {
      const validated = validateWorkspaceFiles(sysmlWorkspace);
      const validity = ensureWorkspaceValid(validated);
      if (!validity.ok) {
        return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
      }
      const createdManifest = await repository.createWorkspace(validated, { ownerId: req.user?.id });
      currentWorkspaceId = createdManifest.id;
      return res.status(201).json({ status: 'imported', manifest: createdManifest });
    }

    const candidate = (req.body as { workspace?: WorkspaceFiles } & Partial<WorkspaceFiles>).workspace ?? req.body;
    const validated = validateWorkspaceFiles(candidate as WorkspaceFiles);
    const manifest = workspaceManifestSchema.parse({ ...validated.manifest, version: 1 });
    const workspace: WorkspaceFiles = { ...validated, manifest };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const createdManifest = await repository.createWorkspace(workspace, { ownerId: req.user?.id });
    currentWorkspaceId = createdManifest.id;
    res.status(201).json({ status: 'imported', manifest: createdManifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post(
  '/api/workspaces/current/duplicate',
  requireUser(),
  requireWorkspacePermission('write'),
  async (req, res) => {
    if (!currentWorkspaceId) return res.status(400).json({ message: 'No workspace open' });
    const { id, name, version } = req.body as Partial<WorkspaceManifest>;
    if (!id || !name) return res.status(400).json({ message: 'id and name are required' });
    try {
      const sourceManifest = await repository.getManifest(currentWorkspaceId);
      if (!sourceManifest) return res.status(404).json({ message: 'Source workspace not found' });
      if (version !== sourceManifest.version) {
        return res.status(409).json({
          message: 'Workspace has been updated elsewhere',
          expected: version,
          actual: sourceManifest.version,
        });
      }
      const manifest: WorkspaceManifest = {
        id,
        name,
        description: sourceManifest.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      const duplicated = await repository.duplicateWorkspace(currentWorkspaceId, manifest, {
        ownerId: req.user?.id,
      });
      currentWorkspaceId = duplicated.id;
      res.status(201).json({ status: 'duplicated', manifest: duplicated });
    } catch (error) {
      res.status(400).json({ message: 'Duplicate failed', details: String(error) });
    }
  },
);

app.post('/api/workspaces/current/new-id', requireUser(), (_req, res) => {
  res.json({ id: uuid() });
});

app.listen(port, () => {
  console.log(`Workspace server listening on port ${port}`);
});
