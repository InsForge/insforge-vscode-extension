import * as vscode from 'vscode';
import { AuthProvider, Organization, Project } from '../auth/authProvider';

const INSTALLED_MCP_KEY = 'insforge.installedMcpProject';

export class ProjectsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'insforge.projectsView';

  private _view?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _authProvider: AuthProvider
  ) {
    // Refresh when auth state changes
    _authProvider.onDidChangeAuth(() => this.refresh());
  }

  /**
   * Set the extension context for state management
   */
  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  /**
   * Get the project ID that currently has MCP installed (only one at a time)
   */
  public getInstalledMcpProject(): string | null {
    if (!this._context) return null;
    return this._context.globalState.get<string | null>(INSTALLED_MCP_KEY, null);
  }

  /**
   * Mark a project as having MCP installed (replaces any previous)
   */
  public async markMcpInstalled(projectId: string): Promise<void> {
    if (!this._context) return;
    await this._context.globalState.update(INSTALLED_MCP_KEY, projectId);
    this.refresh();
  }

  /**
   * Check if a project has MCP installed
   */
  public isMcpInstalled(projectId: string): boolean {
    return this.getInstalledMcpProject() === projectId;
  }

  // ============================================================
  // TODO: MUST DISABLE BEFORE PUBLISH - Development only method
  // ============================================================
  /**
   * Clear the installed MCP project state (for testing)
   */
  public async clearInstalledMcpProject(): Promise<void> {
    if (!this._context) return;
    await this._context.globalState.update(INSTALLED_MCP_KEY, undefined);
    this.refresh();
  }

  public refresh(): void {
    if (this._view) {
      this._updateContent();
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._updateContent();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'login':
          vscode.commands.executeCommand('insforge.login');
          break;
        case 'selectProject':
          await this._handleSelectProject(message.orgId, message.projectId);
          break;
        case 'createProject':
          const createUrl = `https://insforge.dev/dashboard/organization/${message.orgId}/projects?create-project=true`;
          vscode.env.openExternal(vscode.Uri.parse(createUrl));
          break;
        case 'installMcp':
          await this._handleInstallMcp(message.orgId, message.projectId);
          break;
        case 'openInInsforge':
          const openUrl = `https://insforge.dev/dashboard/organization/${message.orgId}/projects`;
          vscode.env.openExternal(vscode.Uri.parse(openUrl));
          break;
        case 'viewProjectDetails':
          const projectUrl = `https://insforge.dev/dashboard/project/${message.projectId}`;
          vscode.env.openExternal(vscode.Uri.parse(projectUrl));
          break;
        case 'refresh':
          this.refresh();
          break;
      }
    });
  }

  private async _handleSelectProject(orgId: string, projectId: string): Promise<void> {
    const orgs = await this._authProvider.getOrganizations();
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    const projects = await this._authProvider.getProjects(orgId);
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    this._authProvider.setCurrentOrg(org);
    this._authProvider.setCurrentProject(project);

    vscode.window.showInformationMessage(`Selected project: ${project.name}`);
  }

  private async _handleInstallMcp(orgId: string, projectId: string): Promise<void> {
    const orgs = await this._authProvider.getOrganizations();
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    const projects = await this._authProvider.getProjects(orgId);
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Set current org and project
    this._authProvider.setCurrentOrg(org);
    this._authProvider.setCurrentProject(project);

    // Execute install MCP command
    vscode.commands.executeCommand('insforge.installMcp');
  }

  private async _updateContent(): Promise<void> {
    if (!this._view) return;

    const isLoggedIn = await this._authProvider.isAuthenticated();

    if (!isLoggedIn) {
      this._view.webview.html = this._getWelcomeHtml(this._view.webview);
      return;
    }

    const orgs = await this._authProvider.getOrganizations();
    const orgsWithProjects: Array<{ org: Organization; projects: Project[] }> = [];

    for (const org of orgs) {
      const projects = await this._authProvider.getProjects(org.id);
      orgsWithProjects.push({ org, projects });
    }

    this._view.webview.html = this._getProjectsHtml(this._view.webview, orgsWithProjects);
  }

  private _getWelcomeHtml(webview: vscode.Webview): string {
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'logo-dark.svg')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this._getStyles()}
</head>
<body>
  <div class="welcome-container">
    <img class="logo" src="${logoUri}" alt="InsForge Logo" />
    <p class="welcome-text">
      Install and manage MCP servers with one click.<br/>
      Power AI coding assistants across IDEs.
    </p>
    <button class="btn primary" onclick="login()">Log in to InsForge</button>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    function login() {
      vscode.postMessage({ command: 'login' });
    }
  </script>
</body>
</html>`;
  }

  private _getProjectsHtml(
    webview: vscode.Webview,
    orgsWithProjects: Array<{ org: Organization; projects: Project[] }>
  ): string {
    const folderIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'folder.svg')
    );
    const mcpIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'mcp.svg')
    );
    const connectIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'connect.svg')
    );
    const sendIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'send.svg')
    );
    const checkedIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'checked.svg')
    );
    const copyIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icons', 'copy.svg')
    );

    const orgsHtml = orgsWithProjects.map(({ org, projects }) => {
      if (projects.length === 0) {
        // Empty state for org with no projects
        return `
          <div class="org-section">
            <div class="org-header" onclick="toggleOrg('${org.id}')">
              <span class="codicon codicon-chevron-down" id="chevron-${org.id}"></span>
              <span class="codicon codicon-organization"></span>
              <span class="org-name">${this._escapeHtml(org.name)}</span>
              <button class="org-open-btn" onclick="event.stopPropagation(); openInInsforge('${org.id}')" title="Open in InsForge">
                Open in InsForge
                <span class="codicon codicon-link-external"></span>
              </button>
            </div>
            <div class="org-content" id="content-${org.id}">
              <div class="empty-state">
                <img class="folder-icon" src="${folderIconUri}" alt="Folder" />
                <p class="empty-title">No Projects Yet</p>
                <p class="empty-desc">Add your first project to get started</p>
                <button class="btn primary" onclick="createProject('${org.id}')">Create First Project</button>
              </div>
            </div>
          </div>
        `;
      }

      // Org with projects
      const installedProjectId = this.getInstalledMcpProject();

      const projectsHtml = projects.map(project => {
        const statusText = project.status || 'Unknown';
        const locationText = project.region || 'Unknown';
        const databaseSize = project.storage_disk_size ? `${project.storage_disk_size} GB` : 'Unknown';
        const isMcpInstalled = installedProjectId === project.id;

        // Show green dot if MCP is installed, otherwise show Install button
        const mcpStatusHtml = isMcpInstalled
          ? `<span class="mcp-connected-dot" title="MCP Connected"></span>`
          : `<button class="install-btn" onclick="event.stopPropagation(); installMcp('${org.id}', '${project.id}')" title="Install MCP">
              <img class="mcp-icon" src="${mcpIconUri}" alt="MCP" />
              <span class="install-text">Install MCP</span>
            </button>`;

        return `
        <div class="project-section">
          <div class="project-header" onclick="toggleProject('${project.id}')">
            <span class="codicon codicon-chevron-right" id="project-chevron-${project.id}"></span>
            <span class="codicon codicon-project"></span>
            <span class="project-name">${this._escapeHtml(project.name)}</span>
            ${mcpStatusHtml}
          </div>
          <div class="project-content collapsed" id="project-content-${project.id}">
            <div class="project-details">
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value">${this._escapeHtml(statusText)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Location</span>
                <span class="detail-value">${this._escapeHtml(locationText)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Database</span>
                <span class="detail-value">${this._escapeHtml(databaseSize)}</span>
              </div>
              <a class="view-details-link" href="#" onclick="event.preventDefault(); viewProjectDetails('${project.id}')">
                View Details in InsForge
                <span class="codicon codicon-chevron-right"></span>
              </a>
            </div>
          </div>
        </div>
      `;
      }).join('');

      return `
        <div class="org-section">
          <div class="org-header" onclick="toggleOrg('${org.id}')">
            <span class="codicon codicon-chevron-down" id="chevron-${org.id}"></span>
            <span class="codicon codicon-organization"></span>
            <span class="org-name">${this._escapeHtml(org.name)}</span>
            <button class="org-open-btn" onclick="event.stopPropagation(); openInInsforge('${org.id}')" title="Open in InsForge">
              Open in InsForge
              <span class="codicon codicon-link-external"></span>
            </button>
          </div>
          <div class="org-content" id="content-${org.id}">
            ${projectsHtml}
          </div>
        </div>
      `;
    }).join('');

    const hasMcpInstalled = this.getInstalledMcpProject() !== null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/@vscode/codicons/dist/codicon.css">
  ${this._getStyles()}
</head>
<body>
  <div class="projects-container">
    ${orgsHtml.length > 0 ? orgsHtml : '<p class="no-orgs">No organizations found</p>'}
  </div>
  
  <!-- MCP Setup Guide -->
  <div class="guide-wrapper" id="guideWrapper">
    <div class="guide-card" id="guideCard">
      <!-- Step 1: Install MCP -->
      <div class="guide-step ${hasMcpInstalled ? 'hidden' : ''}" id="step1">
        <div class="guide-content">
          <div class="guide-icon">
            <img src="${connectIconUri}" alt="Connect" />
          </div>
          <div class="guide-text">
            <div class="guide-title">Install a new MCP Server</div>
            <div class="guide-desc">Pick a project and connect it to your IDE to get started.</div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
        <div class="guide-footer">
          <span class="guide-step-indicator">1 / 2</span>
          <div class="guide-nav">
            <button class="guide-nav-btn" disabled>
              <span class="codicon codicon-chevron-left"></span>
            </button>
            <button class="guide-nav-btn" onclick="goToStep(2)">
              <span class="codicon codicon-chevron-right"></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Step 2: Verify Connection -->
      <div class="guide-step hidden" id="step2">
        <div class="guide-content">
          <div class="guide-icon">
            <img src="${sendIconUri}" alt="Send" />
          </div>
          <div class="guide-text">
            <div class="guide-title">Verify Connection</div>
            <div class="guide-desc">Send the prompt below to your AI coding agent to verify the connection.</div>
            <div class="guide-prompt-box">
              <span class="prompt-label">prompt</span>
              <button class="prompt-copy" onclick="copyPrompt()" title="Copy">
                <img src="${copyIconUri}" alt="Copy" />
              </button>
              <p class="prompt-text">I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.</p>
            </div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
        <div class="guide-footer">
          <span class="guide-step-indicator">2 / 2</span>
          <div class="guide-nav">
            <button class="guide-nav-btn" onclick="goToStep(1)">
              <span class="codicon codicon-chevron-left"></span>
            </button>
            <button class="guide-nav-btn" disabled>
              <span class="codicon codicon-chevron-right"></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Completion: Connection Verified -->
      <div class="guide-step ${hasMcpInstalled ? '' : 'hidden'}" id="stepComplete">
        <div class="guide-content">
          <div class="guide-icon">
            <img src="${checkedIconUri}" alt="Checked" />
          </div>
          <div class="guide-text">
            <div class="guide-title">Connection Verified</div>
            <div class="guide-desc">Congratulations! You've successfully installed InsForge MCP. Now you can start building your app with InsForge handling backend in your IDE.</div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    function toggleOrg(orgId) {
      const content = document.getElementById('content-' + orgId);
      const chevron = document.getElementById('chevron-' + orgId);
      
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        chevron.classList.remove('codicon-chevron-right');
        chevron.classList.add('codicon-chevron-down');
      } else {
        content.classList.add('collapsed');
        chevron.classList.remove('codicon-chevron-down');
        chevron.classList.add('codicon-chevron-right');
      }
    }
    
    function selectProject(orgId, projectId) {
      vscode.postMessage({ command: 'selectProject', orgId, projectId });
    }
    
    function createProject(orgId) {
      vscode.postMessage({ command: 'createProject', orgId });
    }
    
    function installMcp(orgId, projectId) {
      vscode.postMessage({ command: 'installMcp', orgId, projectId });
    }
    
    function openInInsforge(orgId) {
      vscode.postMessage({ command: 'openInInsforge', orgId });
    }
    
    function toggleProject(projectId) {
      const content = document.getElementById('project-content-' + projectId);
      const chevron = document.getElementById('project-chevron-' + projectId);
      
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        chevron.classList.remove('codicon-chevron-right');
        chevron.classList.add('codicon-chevron-down');
      } else {
        content.classList.add('collapsed');
        chevron.classList.remove('codicon-chevron-down');
        chevron.classList.add('codicon-chevron-right');
      }
    }
    
    function viewProjectDetails(projectId) {
      vscode.postMessage({ command: 'viewProjectDetails', projectId });
    }
    
    // Guide functions
    function goToStep(step) {
      document.getElementById('step1').classList.add('hidden');
      document.getElementById('step2').classList.add('hidden');
      document.getElementById('stepComplete').classList.add('hidden');
      
      if (step === 1) {
        document.getElementById('step1').classList.remove('hidden');
      } else if (step === 2) {
        document.getElementById('step2').classList.remove('hidden');
      } else {
        document.getElementById('stepComplete').classList.remove('hidden');
      }
    }
    
    function closeGuide() {
      document.getElementById('guideCard').classList.add('hidden');
    }
    
    function copyPrompt() {
      const promptText = "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";
      const copyBtn = document.querySelector('.prompt-copy');
      const copyIcon = copyBtn.querySelector('img');
      
      // Prevent clicking if already copying
      if (copyBtn.disabled) return;
      
      navigator.clipboard.writeText(promptText).then(() => {
        // Change to checked icon and disable button
        copyBtn.disabled = true;
        copyIcon.src = "${checkedIconUri}";
        copyBtn.style.opacity = '0.7';
        
        // Restore after 3 seconds
        setTimeout(() => {
          copyIcon.src = "${copyIconUri}";
          copyBtn.disabled = false;
          copyBtn.style.opacity = '1';
        }, 3000);
      });
    }
  </script>
</body>
</html>`;
  }

  private _getStyles(): string {
    return `<style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
    }
    
    /* Welcome styles */
    .welcome-container {
      height: 100vh;
      width: 100%;
      max-width: 386px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 20px;
      text-align: center;
    }
    
    .logo {
      width: 80px;
      height: 80px;
      margin-bottom: 24px;
    }
    
    .welcome-text {
      font-size: 14px;
      line-height: 24px;
      color: var(--vscode-foreground);
      margin-bottom: 40px;
    }
    
    /* Button styles */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 10px;
      font-size: 14px;
      line-height: 24px;
      font-family: var(--vscode-font-family);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    
    .btn.primary {
      width: 100%;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    
    .btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    /* Projects list styles */
    .projects-container {
      min-height: 100vh;
      padding: 0 0 160px 0;
    }
    
    .org-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
    }
    
    .org-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .org-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      line-height: 24px;
    }
    
    .org-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0px 4px;
      font-size: 12px;
      line-height: 21px;
      color: var(--vscode-foreground);
      background: #404040;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
    }
    
    .org-header:hover .org-open-btn {
      opacity: 1;
    }
    
    .org-open-btn .codicon {
      font-size: 12px;
    }
    
    .org-content {
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    
    .org-content.collapsed {
      display: none;
    }
    
    .project-section {
      margin-left: 16px;
    }
    
    .project-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
    }
    
    .project-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .project-header:hover .install-btn {
      opacity: 1;
    }
    
    .project-name {
      flex: 1;
      font-size: 14px;
      line-height: 24px;
    }
    
    .project-content {
      overflow: hidden;
    }
    
    .project-content.collapsed {
      display: none;
    }
    
    .project-details {
      padding: 0 8px 12px 30px;
    }
    
    .detail-row {
      display: flex;
      justify-content: start;
      gap: 8px;
      padding: 4px 0;
    }
    
    .detail-label {
      font-size: 14px;
      line-height: 24px;
      color: var(--vscode-descriptionForeground);
    }
    
    .detail-value {
      font-size: 14px;
      line-height: 24px;
      text-transform: capitalize;
      color: var(--vscode-foreground);
    }
    
    .view-details-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      color: #10B981;
      text-decoration: none;
      cursor: pointer;
    }
    
    .view-details-link .codicon {
      font-size: 20px;
    }
    
    .install-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0px 4px;
      font-size: 12px;
      line-height: 21px;
      color: var(--vscode-button-foreground);
      background: #404040;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    
    .install-btn .mcp-icon {
      width: 16px;
      height: 16px;
    }
    
    .install-text {
      white-space: nowrap;
    }
    
    .mcp-connected-dot {
      width: 8px;
      height: 8px;
      background-color: #10B981;
      border-radius: 50%;
      flex-shrink: 0;
    }
    
    /* Empty state styles */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      text-align: center;
    }
    
    .folder-icon {
      width: 40px;
      height: 40px;
      margin-bottom: 12px;
    }
    
    .empty-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    
    .empty-desc {
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 32px;
    }
    
    .no-orgs {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    
    /* Codicon styles */
    .codicon {
      font-size: 16px;
    }
    
    /* Guide wrapper - fixed at bottom */
    .guide-wrapper {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 20px;
      z-index: 100;
    }
    
    .guide-card {
      background: var(--vscode-editorWidget-background, ##262626);
      border-radius: 8px;
      overflow: hidden;
    }
    
    .guide-card.hidden {
      display: none;
    }
    
    .guide-step {
      display: flex;
      flex-direction: column;
    }
    
    .guide-step.hidden {
      display: none;
    }
    
    .guide-content {
      display: flex;
      gap: 8px;
      padding: 12px;
      align-items: flex-start;
    }
    
    .guide-icon {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .guide-icon img {
      width: 28px;
      height: 28px;
    }
    
    .guide-text {
      flex: 1;
      min-width: 0;
    }
    
    .guide-title {
      font-size: 18px;
      font-weight: 600;
      line-height: 28px;
      color: white;
      margin-bottom: 8px;
    }
    
    .guide-desc {
      font-size: 14px;
      line-height: 21px;
      color: #F5F5F5;
    }
    
    .guide-close {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #737373;
    }
    
    .guide-close .codicon {
      font-size: 24px;
    }
    
    /* Prompt box */
    .guide-prompt-box {
      margin-top: 8px;
      padding: 12px;
      background: #404040;
      border-radius: 8px;
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .prompt-label {
      font-size: 12px;
      line-height: 20px;
      color: #FAFAFA;
    }
    
    .prompt-copy {
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      background-color: #262626;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.10);
    }
    
    .prompt-copy img {
      width: 16px;
      height: 16px;
    }
    
    .prompt-text {
      font-size: 14px;
      line-height: 24px;
      color: #D4D4D4;
    }
    
    /* Guide footer with navigation */
    .guide-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-editorWidget-border, #404040);
    }
    
    .guide-step-indicator {
      font-size: 14px;
      line-height: 21px;
      color: #F5F5F5;
    }
    
    .guide-nav {
      display: flex;
      gap: 4px;
    }
    
    .guide-nav-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.8;
      transition: opacity 0.15s ease;
    }
    
    .guide-nav-btn:hover:not(:disabled) {
      opacity: 1;
    }
    
    .guide-nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .guide-nav-btn .codicon {
      font-size: 20px;
    }
  </style>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
