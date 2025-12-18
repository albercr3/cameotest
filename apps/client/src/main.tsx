import React from 'react';
import ReactDOM from 'react-dom/client';
import WorkspaceShell from './WorkspaceShell';
import './styles/theme.css';
import './styles.css';
import './styles/magicgrid.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root container missing in index.html');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <WorkspaceShell />
  </React.StrictMode>,
);
