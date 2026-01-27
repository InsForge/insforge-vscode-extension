/**
 * Terminal output utilities for MCP installation
 * Handles formatting and building terminal messages for installation results
 */

// ASCII art logo for InsForge
export const INSFORGE_LOGO = `
██╗███╗   ██╗███████╗███████╗ ██████╗ ██████╗  ██████╗ ███████╗
██║████╗  ██║██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
██║██╔██╗ ██║███████╗█████╗  ██║   ██║██████╔╝██║  ███╗█████╗
██║██║╚██╗██║╚════██║██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
██║██║ ╚████║███████║██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
╚═╝╚═╝  ╚═══╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`;

// Formatting constants
export const LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Format a section header with decorative lines
 */
export function formatHeader(text: string): string {
  return `\n${LINE}\n  ${text}\n${LINE}\n`;
}

/**
 * Strip ANSI escape codes from string for cleaner terminal display
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Result of running the installer (used for building terminal output)
 */
export interface InstallerResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Build terminal output message based on installer result
 */
export function buildTerminalOutput(
  result: InstallerResult,
  clientLabel: string,
  clientId: string
): string {
  const lines: string[] = [];

  // Always show what we were trying to do
  lines.push(formatHeader('InsForge MCP Installer'));
  lines.push(`Target: ${clientLabel} (${clientId})`);
  lines.push('');

  if (result.success) {
    // Success case - show logo and success message
    lines.push(formatHeader('Installation Complete!'));
    lines.push(INSFORGE_LOGO);
    lines.push('✓ InsForge MCP is now configured!');
    lines.push('');
    lines.push('Next steps:');
    lines.push('  1. Restart your coding agent to load InsForge');
    lines.push('  2. Try these commands in your agent:');
    lines.push('');
    lines.push('     "Create a posts table with title, content, and author"');
    lines.push('     (Sets up your database schema)');
    lines.push('');
    lines.push('     "Add image upload for user profiles"');
    lines.push('     (Creates storage bucket and handles file uploads)');
    lines.push('');
    lines.push('Learn more:');
    lines.push('  📚 Documentation: https://docs.insforge.dev/introduction');
    lines.push('  💬 Discord: https://discord.com/invite/MPxwj5xVvW');
    lines.push('  ⭐ GitHub: https://github.com/insforge/insforge');
    lines.push('');
  } else {
    // Failure case - show error details
    lines.push(formatHeader('Installation Failed'));
    lines.push('');

    // Show error message
    if (result.error) {
      lines.push(`✗ Error: ${result.error}`);
    } else {
      lines.push(`✗ Installer exited with code: ${result.exitCode}`);
    }
    lines.push('');

    // Show captured stdout if any (may contain useful info)
    if (result.stdout && result.stdout.trim()) {
      lines.push('--- Installer Output ---');
      lines.push(stripAnsi(result.stdout.trim()));
      lines.push('');
    }

    // Show stderr if any
    if (result.stderr && result.stderr.trim()) {
      lines.push('--- Error Output ---');
      lines.push(stripAnsi(result.stderr.trim()));
      lines.push('');
    }

    lines.push(LINE);
    lines.push('');
    lines.push('Troubleshooting:');
    lines.push('  • Make sure you have Node.js and npm installed');
    lines.push('  • Check your network connection');
    lines.push('  • Try running manually: npx @insforge/install --client ' + clientId);
    lines.push('');
    lines.push('Need help?');
    lines.push('  💬 Discord: https://discord.com/invite/MPxwj5xVvW');
    lines.push('  📚 Docs: https://docs.insforge.dev/introduction');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use buildTerminalOutput instead
 */
export function getPostInstallMessage(clientName: string): string {
  return `${INSFORGE_LOGO}
✓ InsForge MCP is now configured for ${clientName}!

Next steps:
  1. Restart your coding agent to load InsForge
  2. Try these commands in your agent:

     "Create a posts table with title, content, and author"
     (Sets up your database schema)

     "Add image upload for user profiles"
     (Creates storage bucket and handles file uploads)

Learn more:
  📚 Documentation: https://docs.insforge.dev/introduction
  💬 Discord: https://discord.com/invite/MPxwj5xVvW
  ⭐ GitHub: https://github.com/insforge/insforge
`;
}
