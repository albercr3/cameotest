import path from 'path';
import { fileURLToPath } from 'url';

import { FileWorkspaceRepository } from './workspaceRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const repository = new FileWorkspaceRepository({
    baseDir: process.env.WORKSPACE_STORAGE_DIR ?? path.resolve(__dirname, '../../../data/workspaces'),
    legacyDir: path.resolve(__dirname, '../../../examples/workspaces'),
  });
  await repository.bootstrapLegacyWorkspaces();
  console.log('Legacy workspaces migrated into repository storage.');
}

run().catch((error) => {
  console.error('Failed to migrate workspaces', error);
  process.exit(1);
});
