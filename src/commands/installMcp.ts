import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { AuthProvider, Project } from '../auth/authProvider';
import { testMcpConnection } from '../utils/mcpVerifier';
import { getInsForgeCredentialsFromConfig, getConfigPath } from '../utils/mcpConfigReader';

/**
 * MCP installation status
 */
export type McpStatus = 'none' | 'verifying' | 'verified' | 'failed';

/**
 * Callbacks for MCP installation status changes
 */
export interface McpStatusCallbacks {
  onVerifying?: (projectId: string, clientId?: string, workspaceFolder?: string) => void;
  onVerified?: (projectId: string, tools: string[], clientId?: string, workspaceFolder?: string) => void;
  onFailed?: (projectId: string, error: string, clientId?: string, workspaceFolder?: string) => void;
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
  { id: 'windsurf', label: 'Windsurf', description: 'Windsurf IDE (~/.codeium/windsurf/mcp_config.json)', projectLocal: false, icon: 'windsurf' },
  { id: 'cline', label: 'Cline', description: 'Cline VS Code Extension (VS Code globalStorage)', projectLocal: false, icon: 'cline' },
  { id: 'roocode', label: 'Roo Code', description: 'Roo-Code VS Code Extension (VS Code globalStorage)', projectLocal: false, icon: 'roo_code' },
  { id: 'copilot', label: 'GitHub Copilot', description: 'Project-local (.vscode/mcp.json)', projectLocal: true, icon: 'copilot' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI (~/.codex/mcp_config.json)', projectLocal: false, icon: 'codex' },
  { id: 'trae', label: 'Trae', description: 'Trae IDE (Trae/User/mcp.json)', projectLocal: false, icon: 'trae' },
  { id: 'qoder', label: 'Qoder', description: 'Qoder IDE (Qoder/SharedClientCache/mcp.json)', projectLocal: false, icon: 'qoder' },
  { id: 'kiro', label: 'Kiro', description: 'Kiro IDE (~/.kiro/settings/mcp.json)', projectLocal: false, icon: 'kiro' },
] as const;

/**
 * Result of running the installer
 */
interface InstallerResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

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

/**
 * Verify MCP connection using credentials from the config file
 * Returns specific error messages to help diagnose issues
 */
async function verifyFromConfig(
  clientId: string,
  workspaceFolder?: string,
  maxAttempts: number = 5,
  delayMs: number = 1000
): Promise<{ success: boolean; tools?: string[]; error?: string }> {
  const configPath = getConfigPath(clientId, workspaceFolder);
  let lastError = '';
  let configFileFound = false;
  let credentialsFound = false;

  // Try multiple times as the config file might take a moment to be written
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Small delay to ensure file is written
    await sleep(delayMs);

    // Read credentials from config file
    const credentials = getInsForgeCredentialsFromConfig(clientId, workspaceFolder);

    if (!credentials) {
      console.log(`Attempt ${attempt}/${maxAttempts}: Config file not found or credentials missing`);
      lastError = `Config file not found or missing InsForge credentials at: ${configPath}`;
      continue;
    }

    // If we get here, config was found and credentials extracted
    configFileFound = true;
    credentialsFound = true;

    // Test connection using credentials from the config file
    const result = await testMcpConnection(credentials.apiKey, credentials.apiBaseUrl);

    if (result.success && result.tools) {
      return { success: true, tools: result.tools };
    }

    lastError = result.error || 'Connection test failed';
    console.log(`Attempt ${attempt}/${maxAttempts}: Connection test failed - ${lastError}`);
  }

  // Provide specific error message based on what failed
  if (!configFileFound) {
    return { 
      success: false, 
      error: `Config file not found at: ${configPath}. The installer may have written to a different location.`
    };
  }
  
  if (!credentialsFound) {
    return {
      success: false,
      error: `Config file exists but InsForge credentials not found. Check if 'insforge' server is configured in ${configPath}`
    };
  }

  return { 
    success: false, 
    error: `Config found but MCP connection failed: ${lastError}` 
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    // Step 5: Mark as verifying (yellow dot) - include clientId and workspaceFolder for retry
    statusCallbacks?.onVerifying?.(project.id, clientPick.id, workspaceFolder);

    // Step 6: Run installer with progress
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing InsForge MCP for ${clientPick.label}...`,
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Running installer...' });

        // Run the installer and wait for it to complete
        const installerResult = await runInstaller(
          clientPick.id,
          apiKey,
          apiBaseUrl,
          workspaceFolder,
          token
        );

        if (!installerResult.success) {
          return {
            success: false,
            tools: [],
            error: installerResult.error || `Installer exited with code ${installerResult.exitCode}`,
            stderr: installerResult.stderr,
          };
        }

        progress.report({ message: 'Verifying connection...' });

        // Installer succeeded, now verify using the config file
        const verifyResult = await verifyFromConfig(clientPick.id, workspaceFolder);

        return verifyResult;
      }
    );

    // Step 7: Handle result
    if (result.success && result.tools) {
      statusCallbacks?.onVerified?.(project.id, result.tools, clientPick.id, workspaceFolder);
      
      vscode.window.showInformationMessage(
        `MCP installed and verified! ${result.tools.length} tools available.`,
        'View Tools'
      ).then(selection => {
        if (selection === 'View Tools') {
          vscode.window.showQuickPick(
            result.tools!.map(t => ({ label: t })),
            { placeHolder: 'Available MCP Tools', canPickMany: false }
          );
        }
      });

      return true;
    } else {
      statusCallbacks?.onFailed?.(project.id, result.error || 'Unknown error', clientPick.id, workspaceFolder);

      const configPath = getConfigPath(clientPick.id, workspaceFolder);
      
      vscode.window.showErrorMessage(
        `MCP installation failed: ${result.error}`,
        'Retry',
        'View Config Path'
      ).then(selection => {
        if (selection === 'Retry') {
          // Re-run installation
          vscode.commands.executeCommand('insforge.installMcp');
        } else if (selection === 'View Config Path' && configPath) {
          vscode.window.showInformationMessage(`Config path: ${configPath}`);
        }
      });

      return false;
    }
  } catch (error) {
    statusCallbacks?.onFailed?.(project.id, String(error), undefined, undefined);
    vscode.window.showErrorMessage(`Failed to install MCP: ${error}`);
    return false;
  }
}

/**
 * Retry MCP verification for a project
 * This MUST read from the config file to verify - no fallback to original credentials
 * because we need to verify the INSTALLATION, not the credentials themselves
 */
export async function retryVerification(
  projectId: string,
  _apiKey: string,  // Not used - kept for API compatibility
  _apiBaseUrl: string,  // Not used - kept for API compatibility
  statusCallbacks?: McpStatusCallbacks,
  clientId?: string,
  workspaceFolder?: string
): Promise<void> {
  statusCallbacks?.onVerifying?.(projectId, clientId, workspaceFolder);

  // Must have clientId to know which config file to read
  if (!clientId) {
    const error = 'Cannot retry: unknown client type. Please reinstall MCP.';
    statusCallbacks?.onFailed?.(projectId, error, clientId, workspaceFolder);
    vscode.window.showErrorMessage(error);
    return;
  }

  // Try to read from config file and verify
  const result = await verifyFromConfig(clientId, workspaceFolder, 5, 1000);

  if (result.success && result.tools) {
    statusCallbacks?.onVerified?.(projectId, result.tools, clientId, workspaceFolder);
    vscode.window.showInformationMessage(`MCP server verified! ${result.tools.length} tools available.`);
  } else {
    // Show specific error about config file issue
    const configPath = getConfigPath(clientId, workspaceFolder);
    const errorMsg = configPath 
      ? `MCP verification failed. Could not read config from: ${configPath}`
      : `MCP verification failed: ${result.error}`;
    
    statusCallbacks?.onFailed?.(projectId, result.error || 'Config file not found', clientId, workspaceFolder);
    vscode.window.showErrorMessage(errorMsg, 'Reinstall MCP').then(selection => {
      if (selection === 'Reinstall MCP') {
        vscode.commands.executeCommand('insforge.installMcp');
      }
    });
  }
}
