import * as vscode from 'vscode';
import * as os from 'os';
import { spawn } from 'child_process';
import { AuthProvider, Project } from '../auth/authProvider';
import { verifyMcpInstallation } from '../utils/mcpVerifier';
import { buildTerminalOutput, InstallerResult } from '../utils/terminalOutput';
import { tryOpenChatWithPrompt, usesTerminalChat } from '../utils/chatOpener';

/**
 * MCP installation status
 */
export type McpStatus = 'none' | 'verifying' | 'verified' | 'failed';

/**
 * Callbacks for MCP installation status changes
 */
export interface McpStatusCallbacks {
  /** Called when user selects an agent and installation is about to start */
  onInstallationStarting?: () => void | Promise<void>;
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

// MCP verification constants
const MCP_VERIFY_MAX_ATTEMPTS = 3;
const MCP_VERIFY_DELAY_MS = 2000;
const MCP_RETRY_MAX_ATTEMPTS = 3;

// Supported MCP clients from @insforge/install
const MCP_CLIENTS = [
  { id: 'cursor', label: 'Cursor', description: 'Cursor IDE (~/.cursor/mcp.json)', projectLocal: false, icon: 'cursor' },
  { id: 'claude-code', label: 'Claude Code', description: 'Project-local (.mcp.json in workspace)', projectLocal: true, icon: 'claude_code' },
  { id: 'antigravity', label: 'Google Antigravity', description: 'Google Antigravity (~/.gemini/antigravity/mcp_config.json)', projectLocal: false, icon: 'antigravity' },
  { id: 'windsurf', label: 'Windsurf', description: 'Windsurf IDE (~/.codeium/windsurf/mcp_config.json)', projectLocal: false, icon: 'windsurf' },
  { id: 'cline', label: 'Cline', description: 'Cline VS Code Extension (VS Code globalStorage)', projectLocal: false, icon: 'cline' },
  { id: 'roocode', label: 'Roo Code', description: 'Roo-Code VS Code Extension (VS Code globalStorage)', projectLocal: false, icon: 'roo_code' },
  { id: 'copilot', label: 'GitHub Copilot', description: 'Project-local (.vscode/mcp.json)', projectLocal: true, icon: 'copilot' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI (managed via codex mcp add)', projectLocal: false, icon: 'codex' },
  { id: 'trae', label: 'Trae', description: 'Trae IDE (Trae/User/mcp.json)', projectLocal: false, icon: 'trae' },
  { id: 'qoder', label: 'Qoder', description: 'Qoder IDE (Qoder/SharedClientCache/mcp.json)', projectLocal: false, icon: 'qoder' },
  { id: 'kiro', label: 'Kiro', description: 'Kiro IDE (~/.kiro/settings/mcp.json)', projectLocal: false, icon: 'kiro' },
] as const;

/**
 * Run the MCP installer and wait for it to complete
 */
async function runInstaller(
  clientId: string,
  apiKey: string,
  apiBaseUrl: string,
  workspaceFolder?: string,
  cancellationToken?: vscode.CancellationToken
): Promise<InstallerResult> {
  return new Promise((resolve) => {
    const args = [
      '@insforge/install',
      '--client', clientId,
      '--env', `API_KEY=${apiKey}`,
      '--env', `API_BASE_URL=${apiBaseUrl}`,
      '-y'
    ];

    const spawnOptions: { cwd?: string; shell: boolean; env: NodeJS.ProcessEnv } = {
      shell: true,
      env: { ...process.env },
    };

    if (workspaceFolder) {
      spawnOptions.cwd = workspaceFolder;
    }

    const installerProcess = spawn('npx', args, spawnOptions);

    let stdout = '';
    let stderr = '';

    installerProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    installerProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    installerProcess.on('error', (err: Error) => {
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        error: err.message,
      });
    });

    installerProcess.on('close', (code: number | null) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });

    // Handle cancellation
    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        installerProcess.kill();
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr,
          error: 'Installation cancelled',
        });
      });
    }
  });
}

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

    // Notify that installation is starting (reset states)
    await statusCallbacks?.onInstallationStarting?.();

    // Step 2: Get workspace folder for project-local clients
    let workspaceFolder: string | undefined;

    if (clientPick.projectLocal) {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        workspaceFolder = os.homedir();
      } else if (workspaceFolders.length === 1) {
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
    }

    // Step 3: Get API key for this project
    const apiKey = await authProvider.getProjectApiKey(project.id);
    if (!apiKey) {
      vscode.window.showErrorMessage('Could not retrieve API key for this project');
      return false;
    }

    // Step 4: Build the API base URL
    const apiBaseUrl = `https://${project.appkey}.${project.region}.insforge.app`;

    // Step 5: Mark as verifying (yellow dot)
    statusCallbacks?.onVerifying?.(project.id);

    // Step 6: Run installer with progress
    const installerResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing InsForge MCP for ${clientPick.label}...`,
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Running installer...' });

        // Run the installer and wait for it to complete
        return await runInstaller(
          clientPick.id,
          apiKey,
          apiBaseUrl,
          workspaceFolder,
          token
        );
      }
    );

    // Step 7: Build terminal output message
    // Always show terminal with installation output for better user experience
    const terminalOutput = buildTerminalOutput(
      installerResult,
      clientPick.label,
      clientPick.id
    );

    const terminal = vscode.window.createTerminal({
      name: `InsForge MCP - ${clientPick.label}`,
      message: terminalOutput.replace(/\n/g, '\r\n'), // Terminal needs \r\n for proper line breaks
    });
    terminal.show();

    // Step 8: Check installer result
    if (!installerResult.success) {
      const errorMsg = installerResult.error || `Installer exited with code ${installerResult.exitCode}`;
      statusCallbacks?.onFailed?.(project.id, errorMsg);
      vscode.window.showErrorMessage(
        `MCP installation failed: ${errorMsg}`,
        'Retry',
        'View Terminal'
      ).then(selection => {
        if (selection === 'Retry') {
          vscode.commands.executeCommand('insforge.installMcp');
        } else if (selection === 'View Terminal') {
          terminal.show();
        }
      });
      return false;
    }

    // Step 9: Verify MCP connection using the credentials directly
    verifyMcpInstallation(
      apiKey,
      apiBaseUrl,
      {
        onVerified: async (tools) => {
          statusCallbacks?.onVerified?.(project.id, tools);
          
          // Try to open AI chat with welcome prompt
          // For terminal-based agents (claude-code, codex), reuse the installation terminal
          const chatOptions = usesTerminalChat(clientPick.id) ? { terminal } : undefined;
          await tryOpenChatWithPrompt(clientPick.id, undefined, chatOptions);
          
          vscode.window.showInformationMessage(
            `MCP server verified! ${tools.length} tools available.`,
            'View Tools'
          ).then(selection => {
            if (selection === 'View Tools') {
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
              retryVerification(project.id, apiKey, apiBaseUrl, statusCallbacks);
            }
          });
        }
      },
    );

    return true;
  } catch (error) {
    statusCallbacks?.onFailed?.(project.id, String(error));
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

  await verifyMcpInstallation(
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
  );
}
