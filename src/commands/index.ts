import * as vscode from 'vscode';
import { AuthProvider, Organization } from '../auth/authProvider';
import { ProjectsViewProvider } from '../views/projectsViewProvider';
import { installMcp } from './installMcp';

/**
 * Check if user is authenticated, prompting login if not.
 * Returns true if authenticated, false otherwise.
 */
async function ensureAuthenticated(
  authProvider: AuthProvider,
  projectsViewProvider: ProjectsViewProvider
): Promise<boolean> {
  const isLoggedIn = await authProvider.isAuthenticated();
  if (!isLoggedIn) {
    const login = await vscode.window.showInformationMessage(
      'Please login first',
      'Login'
    );
    if (login === 'Login') {
      await authProvider.login();
      projectsViewProvider.refresh();
    }
    return false;
  }
  return true;
}

/**
 * Pick an organization ID. If only one org exists, returns it directly.
 * Returns undefined if the user cancels the picker.
 */
async function pickOrganizationId(
  orgs: Organization[],
  placeHolder: string
): Promise<string | undefined> {
  if (orgs.length === 1) {
    return orgs[0].id;
  }
  const orgPick = await vscode.window.showQuickPick(
    orgs.map((org) => ({
      label: org.name,
      description: org.slug,
      orgId: org.id,
    })),
    { placeHolder }
  );
  return orgPick?.orgId;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: AuthProvider,
  projectsViewProvider: ProjectsViewProvider,
  updateStatusBar: () => void
): void {
  // Login command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.login', async () => {
      await authProvider.login();
      projectsViewProvider.refresh();
    })
  );

  // Logout command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.logout', async () => {
      await authProvider.logout();
      projectsViewProvider.refresh();
      updateStatusBar();
    })
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.refresh', () => {
      projectsViewProvider.refresh();
    })
  );

  // Select project via command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.selectProject', async () => {
      if (!await ensureAuthenticated(authProvider, projectsViewProvider)) {
        return;
      }

      // Get organizations
      const orgs = await authProvider.getOrganizations();
      if (orgs.length === 0) {
        vscode.window.showWarningMessage('No organizations found');
        return;
      }

      // Pick organization
      const orgPick = await vscode.window.showQuickPick(
        orgs.map((org) => ({
          label: org.name,
          description: org.slug,
          org,
        })),
        { placeHolder: 'Select an organization' }
      );

      if (!orgPick) {
        return;
      }

      // Get projects
      const projects = await authProvider.getProjects(orgPick.org.id);
      if (projects.length === 0) {
        vscode.window.showWarningMessage('No projects found in this organization');
        return;
      }

      // Pick project
      const projectPick = await vscode.window.showQuickPick(
        projects.map((project) => ({
          label: project.name,
          description: project.region,
          project,
        })),
        { placeHolder: 'Select a project' }
      );

      if (!projectPick) {
        return;
      }

      // Set current org and project
      authProvider.setCurrentOrg(orgPick.org);
      authProvider.setCurrentProject(projectPick.project);

      updateStatusBar();
      vscode.window.showInformationMessage(
        `Selected project: ${projectPick.project.name}`
      );
    })
  );

  // Open org dashboard pages (subscription, usage)
  for (const { command, page } of [
    { command: 'insforge.openSubscription', page: 'subscription' },
    { command: 'insforge.openUsage', page: 'usage' },
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        if (!await ensureAuthenticated(authProvider, projectsViewProvider)) {
          return;
        }

        const orgs = await authProvider.getOrganizations();
        if (orgs.length === 0) {
          vscode.window.showWarningMessage('No organizations found');
          return;
        }

        const orgId = await pickOrganizationId(orgs, `Select an organization to view ${page}`);
        if (!orgId) return;

        const url = `https://insforge.dev/dashboard/organization/${orgId}/${page}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      })
    );
  }

  // Install MCP command - uses current project
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.installMcp', async () => {
      const project = authProvider.getCurrentProject();

      if (!project) {
        if (!await ensureAuthenticated(authProvider, projectsViewProvider)) {
          return;
        }
        vscode.window.showWarningMessage('Please select a project first');
        return;
      }

      const success = await installMcp(project, authProvider, context.extensionUri, {
        onInstallationStarting: () => {
          // Reset all MCP states and guide card when starting new installation
          projectsViewProvider.resetMcpStatesForNewInstallation();
        },
        onVerifying: (projectId) => {
          projectsViewProvider.markMcpVerifying(projectId);
        },
        onVerified: async (projectId, tools) => {
          projectsViewProvider.markMcpVerified(projectId, tools);

          // Start socket listener to wait for real MCP connection
          try {
            const apiKey = await authProvider.getProjectApiKey(projectId);
            if (apiKey && project) {
              projectsViewProvider.startSocketListener(project, apiKey);
            }
          } catch (err) {
            console.error('[installMcp] Failed to start MCP socket listener:', err);
          }
        },
        onFailed: (projectId, error) => {
          projectsViewProvider.markMcpFailed(projectId, error);
        }
      });
    })
  );

  // Reset state command (for development/testing)
  // This command is hidden from the command palette
  // When need to use, add the following to the package.json:
  // "contributes": {
  //   "commands": [
  //     {
  //       "command": "insforge.resetState",
  //       "title": "InsForge: Reset State"
  //     }
  //   ]
  // }
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.resetState', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'This will clear all InsForge extension state. Are you sure?',
        'Yes, Reset',
        'Cancel'
      );
      if (confirm === 'Yes, Reset') {
        await projectsViewProvider.clearAllState();
        vscode.window.showInformationMessage('InsForge state has been reset.');
      }
    })
  );
}
