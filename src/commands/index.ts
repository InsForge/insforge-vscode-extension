import * as vscode from 'vscode';
import { AuthProvider } from '../auth/authProvider';
import { ProjectsViewProvider } from '../views/projectsViewProvider';
import { installMcp } from './installMcp';

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

  // Open Subscription command - shows org picker then opens subscription page
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.openSubscription', async () => {
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
        return;
      }

      const orgs = await authProvider.getOrganizations();
      if (orgs.length === 0) {
        vscode.window.showWarningMessage('No organizations found');
        return;
      }

      let orgId: string;
      if (orgs.length === 1) {
        // Only one org, use it directly
        orgId = orgs[0].id;
      } else {
        // Multiple orgs, let user pick
        const orgPick = await vscode.window.showQuickPick(
          orgs.map((org) => ({
            label: org.name,
            description: org.slug,
            orgId: org.id,
          })),
          { placeHolder: 'Select an organization to view subscription' }
        );
        if (!orgPick) return;
        orgId = orgPick.orgId;
      }

      const url = `https://insforge.dev/dashboard/organization/${orgId}/subscription`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // Open Usage command - shows org picker then opens usage page
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.openUsage', async () => {
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
        return;
      }

      const orgs = await authProvider.getOrganizations();
      if (orgs.length === 0) {
        vscode.window.showWarningMessage('No organizations found');
        return;
      }

      let orgId: string;
      if (orgs.length === 1) {
        // Only one org, use it directly
        orgId = orgs[0].id;
      } else {
        // Multiple orgs, let user pick
        const orgPick = await vscode.window.showQuickPick(
          orgs.map((org) => ({
            label: org.name,
            description: org.slug,
            orgId: org.id,
          })),
          { placeHolder: 'Select an organization to view usage' }
        );
        if (!orgPick) return;
        orgId = orgPick.orgId;
      }

      const url = `https://insforge.dev/dashboard/organization/${orgId}/usage`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // Install MCP command - uses current project
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.installMcp', async () => {
      const project = authProvider.getCurrentProject();

      if (!project) {
        // No project selected - prompt user to select one
        const isLoggedIn = await authProvider.isAuthenticated();
        if (!isLoggedIn) {
          const login = await vscode.window.showInformationMessage(
            'Please login first to install MCP',
            'Login'
          );
          if (login === 'Login') {
            await authProvider.login();
            projectsViewProvider.refresh();
          }
          return;
        }

        vscode.window.showWarningMessage('Please select a project first');
        return;
      }

      const success = await installMcp(project, authProvider, context.extensionUri, {
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
}
