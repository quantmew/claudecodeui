import AccountContent from './content/AccountContent';
import McpServersContent from './content/McpServersContent';
import PermissionsContent from './content/PermissionsContent';
import type { AgentCategoryContentSectionProps } from '../types';

export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  ripperdocPermissions,
  onRipperdocPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  geminiPermissionMode,
  onGeminiPermissionModeChange,
  mcpServers,
  ripperdocMcpServers,
  cursorMcpServers,
  codexMcpServers,
  mcpTestResults,
  mcpServerTools,
  mcpToolsLoading,
  deleteError,
  onOpenMcpForm,
  onDeleteMcpServer,
  onOpenRipperdocMcpForm,
  onDeleteRipperdocMcpServer,
  onTestMcpServer,
  onDiscoverMcpTools,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentCategoryContentSectionProps) {
  // Cursor MCP add/edit/delete was previously a placeholder and is intentionally preserved.
  const noopCursorMcpAction = () => {};

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      {selectedCategory === 'account' && (
        <AccountContent
          agent={selectedAgent}
          authStatus={agentContextById[selectedAgent].authStatus}
          onLogin={agentContextById[selectedAgent].onLogin}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'ripperdoc' && (
        <PermissionsContent
          agent="ripperdoc"
          skipPermissions={ripperdocPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onRipperdocPermissionsChange({ ...ripperdocPermissions, skipPermissions: value });
          }}
          allowedTools={ripperdocPermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onRipperdocPermissionsChange({ ...ripperdocPermissions, allowedTools: value });
          }}
          disallowedTools={ripperdocPermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onRipperdocPermissionsChange({ ...ripperdocPermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
        <PermissionsContent
          agent="codex"
          permissionMode={codexPermissionMode}
          onPermissionModeChange={onCodexPermissionModeChange}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'gemini' && (
        <PermissionsContent
          agent="gemini"
          permissionMode={geminiPermissionMode}
          onPermissionModeChange={onGeminiPermissionModeChange}
        />
      )}

      {selectedCategory === 'mcp' && selectedAgent === 'claude' && (
        <McpServersContent
          agent="claude"
          servers={mcpServers}
          onAdd={() => onOpenMcpForm()}
          onEdit={(server) => onOpenMcpForm(server)}
          onDelete={onDeleteMcpServer}
          onTest={onTestMcpServer}
          onDiscoverTools={onDiscoverMcpTools}
          testResults={mcpTestResults}
          serverTools={mcpServerTools}
          toolsLoading={mcpToolsLoading}
          deleteError={deleteError}
        />
      )}

      {selectedCategory === 'mcp' && selectedAgent === 'ripperdoc' && (
        <McpServersContent
          agent="ripperdoc"
          servers={ripperdocMcpServers}
          onAdd={() => onOpenRipperdocMcpForm()}
          onEdit={(server) => onOpenRipperdocMcpForm(server)}
          onDelete={onDeleteRipperdocMcpServer}
          onTest={onTestMcpServer}
          onDiscoverTools={onDiscoverMcpTools}
          testResults={mcpTestResults}
          serverTools={mcpServerTools}
          toolsLoading={mcpToolsLoading}
          deleteError={deleteError}
        />
      )}

      {selectedCategory === 'mcp' && selectedAgent === 'cursor' && (
        <McpServersContent
          agent="cursor"
          servers={cursorMcpServers}
          onAdd={noopCursorMcpAction}
          onEdit={noopCursorMcpAction}
          onDelete={noopCursorMcpAction}
        />
      )}

      {selectedCategory === 'mcp' && selectedAgent === 'codex' && (
        <McpServersContent
          agent="codex"
          servers={codexMcpServers}
          onAdd={() => onOpenCodexMcpForm()}
          onEdit={(server) => onOpenCodexMcpForm(server)}
          onDelete={(serverId) => onDeleteCodexMcpServer(serverId)}
          deleteError={deleteError}
        />
      )}
    </div>
  );
}
