# InsForge VS Code Extension

Install and manage InsForge MCP servers with one click.

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the InsForge icon in the Activity Bar (left sidebar)
3. Click "Login with InsForge" to authenticate
4. Select your organization and project
5. Click the cloud icon to install MCP for your project

The extension will automatically configure your MCP settings for Claude, Cursor, or other supported AI assistants.

## Features

- OAuth login with InsForge
- Browse organizations and projects
- One-click MCP installation
- Manage installed MCP servers

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
npm install
npm run compile
```

### Testing (Debug Mode)

1. Open this folder in VS Code
2. Run `npm run watch` in terminal (auto-recompiles on changes)
3. Press `F5` to launch Extension Development Host
4. A new VS Code window opens with the extension loaded
5. Look for "InsForge" in the Activity Bar (left sidebar)

**Tips:**
- Use `Cmd+Shift+P` → "Developer: Reload Window" to reload after changes
- Check "Output" panel → "InsForge" for debug logs
- Set breakpoints in `src/` files for debugging

### Testing (Local Package)

To test the packaged extension before publishing:

```bash
npm run package
```

Then install the generated `.vsix` file:

```bash
code --install-extension insforge-0.0.1.vsix
```

Or in VS Code: `Cmd+Shift+P` → "Extensions: Install from VSIX..." → select the file.

### Commands

- `InsForge: Login` - Start OAuth flow
- `InsForge: Logout` - Clear session
- `InsForge: Select Project` - Pick org/project via QuickPick
- `InsForge: Install MCP` - Install MCP for selected project

## OAuth Setup

Before the extension works, you need to register it as an OAuth client in InsForge:

```bash
curl -X POST https://app.insforge.dev/api/oauth/v1/clients/register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "InsForge VS Code Extension",
    "redirect_uris": ["vscode://insforge.insforge/callback"],
    "allowed_scopes": ["user:read", "organizations:read", "projects:read", "projects:write"],
    "client_type": "public"
  }'
```

Then update the `OAUTH_CLIENT_ID` in `src/auth/authProvider.ts`.

## Architecture

```
src/
├── extension.ts           # Entry point
├── auth/
│   └── authProvider.ts    # OAuth + PKCE flow
├── commands/
│   ├── index.ts           # Command registration
│   └── installMcp.ts      # MCP installation logic
└── views/
    ├── projectTreeProvider.ts   # Org/Project tree
    └── mcpTreeProvider.ts       # Installed MCPs tree
```

## Publishing

```bash
npm run package     # Creates .vsix file
npx vsce publish    # Publish to marketplace
```

### Package Contents

The `.vscodeignore` file excludes source files and dev dependencies to keep the package small. Only the compiled `out/` folder and `resources/` are included.

**Note:** The extension icon must be PNG format for the VS Code Marketplace (SVG is not supported for the main icon).
