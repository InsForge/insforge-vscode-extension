import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * MCP configuration structure (common format used by most clients)
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  servers?: Record<string, McpServerConfig>;
}

/**
 * Extracted InsForge credentials from config file
 */
export interface InsForgeCredentials {
  apiKey: string;
  apiBaseUrl: string;
}

/**
 * Get platform-specific base directory
 * Matches the logic in @insforge/install
 */
function getBaseDir(): string {
  const homeDir = os.homedir();
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      return process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support');
    default: // linux and others
      return process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  }
}

/**
 * Get VS Code globalStorage path
 */
function getVSCodeGlobalStoragePath(): string {
  const baseDir = getBaseDir();
  return path.join(baseDir, 'Code', 'User', 'globalStorage');
}

/**
 * Get the config file path for a specific MCP client
 */
export function getConfigPath(clientId: string, workspaceFolder?: string): string | null {
  const homeDir = os.homedir();
  const baseDir = getBaseDir();
  const vsCodeGlobalStorage = getVSCodeGlobalStoragePath();

  switch (clientId) {
    case 'cursor':
      // ~/.cursor/mcp.json
      return path.join(homeDir, '.cursor', 'mcp.json');

    case 'claude-code':
      // <workspace>/.mcp.json (project-local)
      if (!workspaceFolder) return null;
      return path.join(workspaceFolder, '.mcp.json');

    case 'windsurf':
      // ~/.codeium/windsurf/mcp_config.json
      return path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');

    case 'cline':
      // <baseDir>/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
      return path.join(vsCodeGlobalStorage, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');

    case 'roocode':
      // <baseDir>/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json
      return path.join(vsCodeGlobalStorage, 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json');

    case 'trae':
      // <baseDir>/Trae/User/mcp.json
      return path.join(baseDir, 'Trae', 'User', 'mcp.json');

    case 'codex':
      // ~/.codex/mcp_config.json
      return path.join(homeDir, '.codex', 'mcp_config.json');

    case 'copilot':
      // <workspace>/.vscode/mcp.json (project-local)
      // Note: Copilot uses "servers" instead of "mcpServers"
      if (!workspaceFolder) return null;
      return path.join(workspaceFolder, '.vscode', 'mcp.json');

    case 'qoder':
      // <baseDir>/Qoder/SharedClientCache/mcp.json
      return path.join(baseDir, 'Qoder', 'SharedClientCache', 'mcp.json');

    case 'antigravity':
      // ~/.gemini/antigravity/mcp_config.json
      return path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json');

    case 'kiro':
      return path.join(homeDir, '.kiro', 'settings', 'mcp.json');

    default:
      return null;
  }
}

/**
 * Read and parse MCP config file
 */
export function readMcpConfig(configPath: string): McpConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as McpConfig;
  } catch (error) {
    console.error(`Failed to read MCP config from ${configPath}:`, error);
    return null;
  }
}

/**
 * Extract InsForge credentials from MCP config
 * Looks for an 'insforge' server entry in the config
 * Handles both 'mcpServers' (most clients) and 'servers' (Copilot) formats
 */
export function extractInsForgeCredentials(config: McpConfig, clientId?: string): InsForgeCredentials | null {
  // Copilot uses "servers" instead of "mcpServers"
  const serversObj = clientId === 'copilot' 
    ? config.servers 
    : config.mcpServers;

  // Look for insforge server config
  const serverConfig = serversObj?.['insforge'] || serversObj?.['insforge-mcp'];

  if (!serverConfig) {
    return null;
  }

  // Try to get credentials from env
  if (serverConfig.env) {
    const apiKey = serverConfig.env['API_KEY'];
    const apiBaseUrl = serverConfig.env['API_BASE_URL'];

    if (apiKey && apiBaseUrl) {
      return { apiKey, apiBaseUrl };
    }
  }

  // For antigravity, credentials might be in args instead of env
  if (serverConfig.args && Array.isArray(serverConfig.args)) {
    const args = serverConfig.args;
    let apiKey: string | undefined;
    let apiBaseUrl: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--api_key' && args[i + 1]) {
        apiKey = args[i + 1];
      }
      if (args[i] === '--api_base_url' && args[i + 1]) {
        apiBaseUrl = args[i + 1];
      }
    }

    if (apiKey && apiBaseUrl) {
      return { apiKey, apiBaseUrl };
    }
  }

  return null;
}

/**
 * Get InsForge credentials from the installed config file
 */
export function getInsForgeCredentialsFromConfig(
  clientId: string,
  workspaceFolder?: string
): InsForgeCredentials | null {
  const configPath = getConfigPath(clientId, workspaceFolder);

  if (!configPath) {
    console.error(`Unknown config path for client: ${clientId}`);
    return null;
  }

  const config = readMcpConfig(configPath);

  if (!config) {
    console.error(`Could not read config file: ${configPath}`);
    return null;
  }

  return extractInsForgeCredentials(config, clientId);
}

/**
 * Check if config file exists
 */
export function configFileExists(clientId: string, workspaceFolder?: string): boolean {
  const configPath = getConfigPath(clientId, workspaceFolder);
  return configPath ? fs.existsSync(configPath) : false;
}
