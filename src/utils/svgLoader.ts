import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Load SVG file content as raw HTML string.
 * This allows SVGs to use currentColor and inherit CSS color properties.
 */
export function loadSvg(extensionUri: vscode.Uri, relativePath: string): string {
  const svgPath = vscode.Uri.joinPath(extensionUri, relativePath).fsPath;
  return fs.readFileSync(svgPath, 'utf8');
}
