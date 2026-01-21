import * as vscode from 'vscode';
import { AuthProvider } from './auth/authProvider';
import { ProjectsViewProvider } from './views/projectsViewProvider';
import { registerCommands } from './commands';

let authProvider: AuthProvider;
let statusBarItem: vscode.StatusBarItem;
let projectsViewProvider: ProjectsViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('InsForge extension is now active');

  // Initialize auth provider
  authProvider = new AuthProvider(context);

  // Initialize and register the single projects webview provider
  projectsViewProvider = new ProjectsViewProvider(context.extensionUri, authProvider);
  projectsViewProvider.setContext(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ProjectsViewProvider.viewType, projectsViewProvider)
  );

  // Create status bar item (left side, high priority to be leftmost)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'insforge.selectProject';
  context.subscriptions.push(statusBarItem);

  // Update status bar when auth changes
  authProvider.onDidChangeAuth(() => {
    updateStatusBar();
  });

  // Register all commands
  registerCommands(context, authProvider, projectsViewProvider, updateStatusBar);

  // Initial status bar update
  updateStatusBar();
}

function updateStatusBar() {
  const project = authProvider.getCurrentProject();

  if (project) {
    statusBarItem.text = `$(database) ${project.name}`;
    statusBarItem.tooltip = `InsForge: ${project.name} (${project.region}) - Connected`;
    statusBarItem.show();
  } else {
    statusBarItem.text = '$(database) InsForge';
    statusBarItem.tooltip = 'InsForge: No project selected';
    statusBarItem.show();
  }
}

export function deactivate() {
  console.log('InsForge extension is now deactivated');
}
