/**
 * Mount. The integration adapter (owned by another lane) builds AppProps from the typed
 * bridge and calls `mount`. This file never reads the bridge itself and never mounts
 * with sample data: a real workspace with nothing loaded shows the missing-state words.
 * React and react-dom are provisioned for the isolated library build. Mounting remains
 * an explicit integration-adapter action.
 */

import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App, type AppProps } from './App';
import { ConversationWorkspace, type ConversationWorkspaceProps } from './ConversationWorkspace';
import '../tokens/index.css';
import '../views/simple.css';
import '../views/books.css';

export function mount(container: HTMLElement, props: AppProps): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  return root;
}

export function update(root: Root, props: AppProps): void {
  root.render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
}

export type { AppProps };

/** Explicit opt-in after the trusted host wires the checked Engine controller. */
export function mountConversationWorkspace(container: HTMLElement, props: ConversationWorkspaceProps): Root {
  const root = createRoot(container);
  updateConversationWorkspace(root, props);
  return root;
}

export function updateConversationWorkspace(root: Root, props: ConversationWorkspaceProps): void {
  root.render(<StrictMode><ConversationWorkspace {...props} /></StrictMode>);
}

export type { ConversationWorkspaceProps };
