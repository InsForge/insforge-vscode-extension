import * as vscode from 'vscode';
import { AuthProvider, Project } from '../auth/authProvider';
import { verifyMcpInstallation } from '../utils/mcpVerifier';

/**
 * MCP installation status
 */
export type McpStatus = 'none' | 'verifying' | 'verified' | 'failed';

/**
 * Callbacks for MCP installation status changes
 */
export interface McpStatusCallbacks {
  onVerifying?: (projectId: string) => void;
  onVerified?: (projectId: string, tools: string[]) => void;
  onFailed?: (projectId: string, error: string) => void;
}

/**
 * Check if current VS Code theme is dark
 */
function isDarkTheme(): boolean {
  const theme = vscode.window.activeColorTheme;
  return theme.kind === vscode.ColorThemeKind.Dark || 
         theme.kind === vscode.ColorThemeKind.HighContrast;
}

// Supported MCP clients from @insforge/install
const MCP_CLIENTS = [
  { id: 'cursor', label: 'Cursor', description: 'Cursor IDE (~/.cursor/mcp.json)', projectLocal: false, icon: 'cursor' },
  { id: 'claude-code', label: 'Claude Code', description: 'Project-local (.mcp.json in workspace)', projectLocal: true, icon: 'claude_code' },
  { id: 'antigravity', label: 'Google Antigravity', description: 'Project-local (~/.gemini/antigravity/mcp_config.json)', projectLocal: true, icon: 'antigravity' },
  { id: 'windsurf', label: 'Windsurf', description: 'Windsurf IDE (~/.codeium/windsurf/)', projectLocal: false, icon: 'windsurf' },
  { id: 'cline', label: 'Cline', description: 'Cline VS Code Extension', projectLocal: false, icon: 'cline' },
  { id: 'roocode', label: 'Roo Code', description: 'Roo-Code VS Code Extension', projectLocal: false, icon: 'roo_code' },
  { id: 'copilot', label: 'GitHub Copilot', description: 'Project-local (.vscode/mcp.json)', projectLocal: true, icon: 'copilot' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI', projectLocal: false, icon: 'codex' },
  { id: 'trae', label: 'Trae', description: 'Trae IDE', projectLocal: false, icon: 'trae' },
  { id: 'qoder', label: 'Qoder', description: 'Qoder IDE', projectLocal: false, icon: 'qoder' },
  { id: 'kiro', label: 'Kiro', description: 'Kiro IDE', projectLocal: false, icon: 'kiro' },
] as const;

export async function installMcp(
  project: Project,
  authProvider: AuthProvider,
  extensionUri: vscode.Uri,
  statusCallbacks?: McpStatusCallbacks
): Promise<boolean> {
  try {
    // Step 1: Let user pick which client to install for
    const iconSuffix = isDarkTheme() ? '' : '-light';
    
    const clientPick = await vscode.window.showQuickPick(
      MCP_CLIENTS.map(client => ({
        label: client.label,
        description: client.description,
        id: client.id,
        projectLocal: client.projectLocal,
        iconPath: vscode.Uri.joinPath(extensionUri, 'resources', 'agents', `${client.icon}${iconSuffix}.svg`),
      })),
      {
        placeHolder: 'Select which AI client to install MCP for',
        title: 'Install InsForge MCP',
      }
    );

    if (!clientPick) {
      return false; // User cancelled
    }

    // Step 2: Get workspace folder for project-local clients
    let workspaceFolder: string | undefined;

    if (clientPick.projectLocal) {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          `${clientPick.label} requires an open workspace folder to install MCP config.`
        );
        return false;
      }

      if (workspaceFolders.length === 1) {
        workspaceFolder = workspaceFolders[0].uri.fsPath;
      } else {
        // Multiple workspaces - let user pick
        const folderPick = await vscode.window.showQuickPick(
          workspaceFolders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder: folder,
          })),
          {
            placeHolder: 'Select workspace folder to install MCP config',
            title: 'Select Workspace',
          }
        );

        if (!folderPick) {
          return false;
        }
        workspaceFolder = folderPick.folder.uri.fsPath;
      }

      // Confirm with user
      const confirm = await vscode.window.showInformationMessage(
        `Install InsForge MCP config to: ${workspaceFolder}?`,
        'Yes',
        'Cancel'
      );

      if (confirm !== 'Yes') {
        return false;
      }
    }

    // Step 3: Get API key for this project
    const apiKey = await authProvider.getProjectApiKey(project.id);
    if (!apiKey) {
      vscode.window.showErrorMessage('Could not retrieve API key for this project');
      return false;
    }

    // Step 4: Build the API base URL
    const apiBaseUrl = `https://${project.appkey}.${project.region}.insforge.app`;

    // Build the MCP installer command
    const mcpCommand = buildMcpInstallerCommand(clientPick.id, apiKey, apiBaseUrl);

    // Create terminal with proper working directory
    const terminalOptions: vscode.TerminalOptions = {
      name: `InsForge MCP - ${clientPick.label}`,
      hideFromUser: false,
    };

    // Set cwd for project-local clients
    if (workspaceFolder) {
      terminalOptions.cwd = workspaceFolder;
    }

    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.show();
    terminal.sendText(mcpCommand);

    const location = workspaceFolder ? ` in ${workspaceFolder}` : '';
    vscode.window.showInformationMessage(
      `MCP installer started for ${clientPick.label}${location}. Verifying server connection...`
    );

    // Immediately mark as verifying (yellow dot)
    statusCallbacks?.onVerifying?.(project.id);

    // Start verification in background
    verifyMcpInstallation(
      apiKey,
      apiBaseUrl,
      {
        onVerifying: () => {
          // Already notified above
        },
        onVerified: (tools) => {
          statusCallbacks?.onVerified?.(project.id, tools);
          vscode.window.showInformationMessage(
            `MCP server verified! ${tools.length} tools available.`,
            'View Tools'
          ).then(selection => {
            if (selection === 'View Tools') {
              // Show tools in a quick pick for info
              vscode.window.showQuickPick(
                tools.map(t => ({ label: t })),
                { placeHolder: 'Available MCP Tools', canPickMany: false }
              );
            }
          });
        },
        onFailed: (error) => {
          statusCallbacks?.onFailed?.(project.id, error);
          vscode.window.showWarningMessage(
            `MCP installed but server verification failed: ${error}. The configuration may still work.`,
            'Retry Verification'
          ).then(selection => {
            if (selection === 'Retry Verification') {
              // Trigger re-verification
              retryVerification(project.id, apiKey, apiBaseUrl, statusCallbacks);
            }
          });
        }
      },
      10,  // maxAttempts
      2000 // delayMs between attempts
    );

    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to install MCP: ${error}`);
    return false;
  }
}

/**
 * Retry MCP verification for a project
 */
export async function retryVerification(
  projectId: string,
  apiKey: string,
  apiBaseUrl: string,
  statusCallbacks?: McpStatusCallbacks
): Promise<void> {
  statusCallbacks?.onVerifying?.(projectId);
  
  const result = await verifyMcpInstallation(
    apiKey,
    apiBaseUrl,
    {
      onVerifying: () => {},
      onVerified: (tools) => {
        statusCallbacks?.onVerified?.(projectId, tools);
        vscode.window.showInformationMessage(`MCP server verified! ${tools.length} tools available.`);
      },
      onFailed: (error) => {
        statusCallbacks?.onFailed?.(projectId, error);
        vscode.window.showErrorMessage(`MCP verification failed: ${error}`);
      }
    },
    5,   // fewer attempts for retry
    2000
  );
}

function buildMcpInstallerCommand(client: string, apiKey: string, apiBaseUrl: string): string {
  // Using the @insforge/install package
  return `npx @insforge/install --client ${client} --env API_KEY=${apiKey} --env API_BASE_URL=${apiBaseUrl}`;
}
