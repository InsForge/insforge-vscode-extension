import { spawn, ChildProcess } from 'child_process';

export interface McpVerificationResult {
  success: boolean;
  tools?: string[];
  error?: string;
}

export interface McpVerificationCallbacks {
  onVerifying?: () => void;
  onVerified?: (tools: string[]) => void;
  onFailed?: (error: string) => void;
}

/**
 * Test MCP server connection by spawning the MCP process and sending JSON-RPC requests.
 * This verifies that the API credentials are valid and the MCP server can retrieve tools.
 */
export async function testMcpConnection(
  apiKey: string,
  apiBaseUrl: string,
  timeoutMs: number = 10000
): Promise<McpVerificationResult> {
  return new Promise((resolve) => {
    let mcpProcess: ChildProcess | null = null;
    let buffer = '';
    let resolved = false;

    const cleanup = () => {
      if (mcpProcess && !mcpProcess.killed) {
        mcpProcess.kill();
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, error: 'Connection timeout' });
      }
    }, timeoutMs);

    try {
      // Spawn MCP process with credentials
      mcpProcess = spawn('npx', ['@insforge/mcp'], {
        env: {
          ...process.env,
          API_KEY: apiKey,
          API_BASE_URL: apiBaseUrl,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      mcpProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Try to parse JSON-RPC responses
        const lines = buffer.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            
            // Check for tools/list response
            if (response.result?.tools && Array.isArray(response.result.tools)) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                
                const toolNames = response.result.tools.map((t: { name: string }) => t.name);
                resolve({ success: true, tools: toolNames });
              }
              return;
            }
            
            // Check for error response
            if (response.error) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                resolve({ success: false, error: response.error.message || 'Unknown error' });
              }
              return;
            }
          } catch {
            // Not valid JSON yet, continue buffering
          }
        }
      });

      mcpProcess.stderr?.on('data', (data: Buffer) => {
        const errorText = data.toString();
        // Only treat as error if it contains actual error indicators
        if (errorText.toLowerCase().includes('error') || errorText.toLowerCase().includes('failed')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            resolve({ success: false, error: errorText.trim() });
          }
        }
      });

      mcpProcess.on('error', (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve({ success: false, error: `Process error: ${err.message}` });
        }
      });

      mcpProcess.on('exit', (code: number | null) => {
        if (!resolved && code !== 0) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ success: false, error: `Process exited with code ${code}` });
        }
      });

      // Send JSON-RPC initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'insforge-vscode',
            version: '1.0.0'
          }
        }
      };

      mcpProcess.stdin?.write(JSON.stringify(initRequest) + '\n');

      // Send tools/list request after a short delay
      setTimeout(() => {
        if (!resolved && mcpProcess && !mcpProcess.killed) {
          const toolsRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
          };
          mcpProcess.stdin?.write(JSON.stringify(toolsRequest) + '\n');
        }
      }, 500);

    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ 
          success: false, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }
  });
}

/**
 * Verify MCP installation with retry logic.
 * Polls the MCP server until it responds with a tool list or max attempts reached.
 */
export async function verifyMcpInstallation(
  apiKey: string,
  apiBaseUrl: string,
  callbacks: McpVerificationCallbacks,
  maxAttempts: number = 10,
  delayMs: number = 2000
): Promise<McpVerificationResult> {
  callbacks.onVerifying?.();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Wait before each attempt (including first one to allow npx install to complete)
    await sleep(delayMs);

    const result = await testMcpConnection(apiKey, apiBaseUrl);
    
    if (result.success && result.tools) {
      callbacks.onVerified?.(result.tools);
      return result;
    }

    // Log attempt for debugging
    console.log(`MCP verification attempt ${attempt}/${maxAttempts}: ${result.error || 'No response'}`);
  }

  // All attempts failed
  const error = 'Failed to verify MCP server after maximum attempts';
  callbacks.onFailed?.(error);
  return { success: false, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
