# SysML v2 Interchange Mapping

This guide documents how the Cameo Testbed IR maps to SysML v2 payloads in both JSON and textual forms. The rules here are implemented in `packages/shared/src/sysmlConversion.ts` and used by the workspace API.

## Schema and versioning

* `schemaVersion` defaults to the IR version (`IR_VERSION`), currently `0.1.0`.
* API endpoints accept either `schema` or `version` query parameters to request a specific schema version on export.
* SysML payload envelopes carry a `version` field alongside the `type` discriminator: `sysmlv2-json` or `sysmlv2-text`.

## JSON bundle mapping

The SysML v2 JSON bundle is a normalized mirror of the IR:

| IR concept | SysML JSON field | Notes |
| --- | --- | --- |
| Workspace manifest | `manifest` | Populated from IR manifest; defaults applied with `manifestFromSysml` when absent. |
| Model elements | `model.elements` | Each element is emitted verbatim with IR fields preserved (`metaclass`, `ownerId`, `typeId`, `signalTypeId`, `direction`, `documentation`, `stereotypes`, `tags`, timestamps). |
| Relationships | `model.relationships` | Associations carry `sourceId`, `targetId`, and optional `properties`; connectors carry `sourcePortId`, `targetPortId`, optional `itemFlowLabel`. |
| Diagrams | `diagrams.diagrams` | Diagram shape, nodes, edges, and view settings are copied directly with `type`/`kind` mirrored. |

## Textual bundle mapping

SysML textual payloads flatten the same information into line-oriented records. Lines beginning with `#` are comments. Each line starts with a record kind followed by `key=value` assignments where values are JSON-encoded (strings are quoted, objects/arrays are minified).

Supported record kinds:

* `manifest` — carries `id`, `name`, `description`, `createdAt`, `updatedAt`, `version`.
* `element` — carries IR element fields (`metaclass`, `name`, `ownerId`, `typeId`, `signalTypeId`, `direction`, `documentation`, `stereotypes`, `tags`, timestamps).
* `relationship` — for associations (`sourceId`, `targetId`, `properties`) or connectors (`sourcePortId`, `targetPortId`, `itemFlowLabel`).
* `diagram` — includes `id`, `name`, `type`, `kind`, `ownerId`, optional `contextBlockId`, and `viewSettings`.
* `node` — includes `diagramId`, `id`, `elementId`, `kind`, bounds (`x`, `y`, `w`, `h`), optional `placement`, `compartments`, and `style`.
* `edge` — includes `diagramId`, `id`, `relationshipId`, `sourceNodeId`, `targetNodeId`, optional `routingPoints`, and `label`.

Example line:

```
relationship id="..." type="Connector" sourcePortId="..." targetPortId="..." itemFlowLabel="powerFlow"
```

## Round-trip expectations

* Both JSON and text payloads validate through the shared IR schemas before being persisted.
* Missing optional structures (diagrams, optional element fields) are defaulted by the IR validators to keep imports tolerant.
* Export responses respect requested schema versions and keep manifests synchronized between the SysML envelope and the internal workspace.

Refer to `examples/workspaces/roundtrip-regression` for concrete JSON/text fixtures that exercise diagrams, associations, connectors, and item flows end-to-end.
