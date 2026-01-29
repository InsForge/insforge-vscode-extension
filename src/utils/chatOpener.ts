import * as vscode from 'vscode';

/**
 * Welcome prompt to send to AI chat after MCP installation
 */
export const INSFORGE_WELCOME_PROMPT =
  "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";

/**
 * Chat command configuration for each supported IDE/client
 */
interface ChatCommandConfig {
  /** 
   * Parameter format:
   * - 'object': pass {query, isPartialQuery} directly (Cursor, VSCode Copilot)
   * - 'clipboard': copy to clipboard, open chat, wait, paste (most other IDEs are broken)
   * - 'terminal': run command in terminal (Claude Code, Codex)
   * - undefined: silently skip
   */
  paramFormat?: 'object' | 'clipboard' | 'terminal';
  /** The VSCode command to execute (for 'object' and 'clipboard' modes) */
  command?: string;
  /** CLI command name to run in terminal (for 'terminal' mode, e.g., 'claude', 'codex') */
  terminalCommand?: string;
  /** Custom paste delay in ms for clipboard method (default: 150ms) */
  pasteDelayMs?: number;
  /** 
   * Context key to check before running command. 
   * If this context is true, skip the open command and just paste directly.
   * Useful for IDEs where the open command is a toggle (like Qoder).
   */
  skipCommandIfContext?: string;
}

/** Default delay before pasting for clipboard method */
const DEFAULT_PASTE_DELAY_MS = 150;

/**
 * Chat command configurations for all supported IDEs
 * 
 * To add a new IDE:
 * 1. Find the chat command using Ctrl+K Ctrl+S in that IDE
 * 2. Right-click "New Chat" → "Copy Command ID"  
 * 3. Test if {query, isPartialQuery} works - if yes, use 'object'
 * 4. If not, use 'clipboard' (most IDEs are broken and need this workaround)
 */
const CHAT_COMMANDS: Record<string, ChatCommandConfig> = {
  // Cursor IDE
  'cursor': {
    command: 'workbench.action.chat.open',
    paramFormat: 'object',
  },

  // GitHub Copilot in VSCode
  'copilot': {
    command: 'workbench.action.chat.open',
    paramFormat: 'object',
  },

  // Trae IDE
  'trae': {
    command: 'workbench.action.chat.icube.open',
    paramFormat: 'clipboard',
  },

  // Qoder IDE - open command is a toggle, so check if chat is already open
  'qoder': {
    command: 'workbench.action.aichat.open',
    paramFormat: 'clipboard',
    skipCommandIfContext: 'inChat',
  },

  // Google Antigravity
  'antigravity': {
    command: 'antigravity.prioritized.chat.open',
    paramFormat: 'clipboard',
  },

  // Windsurf IDE
  'windsurf': {
    command: 'windsurf.prioritized.chat.openNewConversation',
    paramFormat: 'clipboard',
  },

  // Kiro IDE
  'kiro': {
    command: 'kiroAgent.focusContinueInput',
    paramFormat: 'clipboard',
    pasteDelayMs: 1000,
  },

  // Terminal-based agents - run command in terminal
  'claude-code': {
    paramFormat: 'terminal',
    terminalCommand: 'claude',
  },
  'codex': {
    paramFormat: 'terminal',
    terminalCommand: 'codex',
  },

  // No chat integration - silently skip
  'cline': {},
  'roocode': {},
};

/**
 * Result of attempting to open chat
 */
export interface ChatOpenResult {
  success: boolean;
  method: 'command' | 'clipboard' | 'terminal' | 'none';
  error?: string;
}

/**
 * Options for tryOpenChatWithPrompt
 */
export interface ChatOpenOptions {
  /** Terminal to use for terminal-based agents (claude-code, codex) */
  terminal?: vscode.Terminal;
}

/**
 * Try to open AI chat with a welcome prompt based on the client type.
 * 
 * @param clientId - The MCP client ID (e.g., 'cursor', 'copilot', etc.)
 * @param prompt - Optional custom prompt (defaults to INSFORGE_WELCOME_PROMPT)
 * @param options - Optional settings like terminal reference for terminal-based agents
 * @returns Result indicating success and method used
 */
export async function tryOpenChatWithPrompt(
  clientId: string,
  prompt: string = INSFORGE_WELCOME_PROMPT,
  options?: ChatOpenOptions
): Promise<ChatOpenResult> {
  const config = CHAT_COMMANDS[clientId];

  // No config or no paramFormat = silently skip
  if (!config || !config.paramFormat) {
    console.debug(`[chatOpener] No chat config for ${clientId}, skipping`);
    return { success: true, method: 'none' };
  }

  try {
    if (config.paramFormat === 'object') {
      // Direct query injection (Cursor, VSCode Copilot)
      await vscode.commands.executeCommand(config.command!, {
        query: prompt,
        isPartialQuery: true,
      });
      return { success: true, method: 'command' };
    } else if (config.paramFormat === 'clipboard') {
      // Clipboard workaround for broken IDEs
      return await openChatWithClipboardPaste(
        config.command!,
        prompt,
        config.pasteDelayMs,
        config.skipCommandIfContext
      );
    } else if (config.paramFormat === 'terminal') {
      return await openChatWithTerminal(
        config.terminalCommand!,
        prompt,
        options?.terminal
      );
    } else {
      return { success: true, method: 'none' };
    }
  } catch (error) {
    console.error(`[chatOpener] Failed for ${clientId}:`, error);
    return { success: false, method: 'none', error: String(error) };
  }
}

/**
 * Try to get a context key value using the unofficial getContext command.
 * Returns undefined if the context cannot be read.
 */
async function getContextValue(contextKey: string): Promise<boolean | undefined> {
  try {
    const value = await vscode.commands.executeCommand('getContext', contextKey);
    console.debug(`[chatOpener] Context '${contextKey}' = ${value}`);
    return value as boolean | undefined;
  } catch (error) {
    console.debug(`[chatOpener] Failed to get context '${contextKey}':`, error);
    return undefined;
  }
}

/**
 * Open chat using clipboard + paste workaround.
 * Most IDEs don't properly support query injection, so we have to:
 * 1. Copy prompt to clipboard
 * 2. Open chat (unless skipCommandIfContext is true)
 * 3. Wait for UI
 * 4. Paste
 */
async function openChatWithClipboardPaste(
  command: string,
  prompt: string,
  delayMs?: number,
  skipCommandIfContext?: string
): Promise<ChatOpenResult> {
  const pasteDelay = delayMs ?? DEFAULT_PASTE_DELAY_MS;

  // Step 1: Copy prompt to clipboard
  await vscode.env.clipboard.writeText(prompt);
  console.debug('[chatOpener] Copied prompt to clipboard');

  // Step 2: Check if we should skip the open command (e.g., chat already open)
  let shouldSkipCommand = false;
  if (skipCommandIfContext) {
    const contextValue = await getContextValue(skipCommandIfContext);
    if (contextValue === true) {
      console.debug(`[chatOpener] Context '${skipCommandIfContext}' is true, skipping command`);
      shouldSkipCommand = true;
    }
  }

  // Step 3: Try to open chat (unless skipped)
  if (!shouldSkipCommand) {
    try {
      console.debug(`[chatOpener] Opening chat command: ${command}`);
      await vscode.commands.executeCommand(command);
      console.debug('[chatOpener] Opened chat');
    } catch (error) {
      // Command failed - tell user to open chat manually and paste
      console.error('[chatOpener] Failed to open chat:', error);
      vscode.window.showInformationMessage(
        'Prompt copied to clipboard. Please open the AI chat and paste it.',
        'OK'
      );
      return { success: true, method: 'clipboard' };
    }
  }

  // Step 4 & 5: Wait then paste
  // If we skipped the command, use a shorter delay since chat is already open
  const actualDelay = shouldSkipCommand ? 50 : pasteDelay;

  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        console.debug('[chatOpener] Pasted prompt into chat');
        resolve({ success: true, method: 'clipboard' });
      } catch (pasteError) {
        // Paste failed - tell user to paste manually
        console.debug('[chatOpener] Paste failed:', pasteError);
        vscode.window.showInformationMessage(
          'Prompt copied to clipboard. Please paste it into the chat input.',
          'OK'
        );
        resolve({ success: true, method: 'clipboard' });
      }
    }, actualDelay);
  });
}

/**
 * Open chat using terminal command.
 * For CLI-based agents like Claude Code and Codex.
 * Sends: `{command} "{prompt}"` to the terminal.
 */
async function openChatWithTerminal(
  terminalCommand: string,
  prompt: string,
  existingTerminal?: vscode.Terminal
): Promise<ChatOpenResult> {
  // Escape double quotes in prompt for shell safety
  const escapedPrompt = prompt.replace(/"/g, '\\"');
  const fullCommand = `${terminalCommand} "${escapedPrompt}"`;

  // Use existing terminal or create a new one
  const terminal = existingTerminal ?? vscode.window.createTerminal({
    name: `InsForge - ${terminalCommand}`,
  });

  terminal.show();
  terminal.sendText(fullCommand);
  
  console.debug(`[chatOpener] Sent to terminal: ${fullCommand}`);
  return { success: true, method: 'terminal' };
}

/**
 * Check if a client has chat command support
 */
export function hasNativeChatSupport(clientId: string): boolean {
  const config = CHAT_COMMANDS[clientId];
  return !!(config && config.paramFormat);
}

/**
 * Get the chat command for a specific client (for debugging)
 */
export function getChatCommand(clientId: string): string | null {
  return CHAT_COMMANDS[clientId]?.command || null;
}

/**
 * Check if a client uses terminal-based chat (Claude Code, Codex)
 */
export function usesTerminalChat(clientId: string): boolean {
  const config = CHAT_COMMANDS[clientId];
  return config?.paramFormat === 'terminal';
}
