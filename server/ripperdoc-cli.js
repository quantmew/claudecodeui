import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import fs from 'fs';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
const activeRipperdocProcesses = new Map();

function sendMessage(ws, data) {
  try {
    if (ws?.isSSEStreamWriter || ws?.isWebSocketWriter) {
      ws.send(data);
      return;
    }

    if (typeof ws?.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Ripperdoc] Failed to send message:', error);
  }
}

function normalizeToolUseBlock(block) {
  if (!block || typeof block !== 'object') {
    return block;
  }

  if (block.type !== 'tool_use' && block.type !== 'tool_result') {
    return block;
  }

  const normalized = { ...block };
  if (!normalized.id && normalized.tool_use_id) {
    normalized.id = normalized.tool_use_id;
  }
  if (!normalized.tool_use_id && normalized.id) {
    normalized.tool_use_id = normalized.id;
  }

  return normalized;
}

function normalizeMessageContent(content) {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((block) => normalizeToolUseBlock(block));
}

function normalizeStreamEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  if (!event.message || typeof event.message !== 'object') {
    return event;
  }

  return {
    ...event,
    message: {
      ...event.message,
      content: normalizeMessageContent(event.message.content),
    },
  };
}

function resolvePermissionMode(permissionMode, toolsSettings) {
  if (toolsSettings?.skipPermissions || permissionMode === 'bypassPermissions') {
    return 'bypassPermissions';
  }

  if (permissionMode === 'dontAsk') {
    return 'dontAsk';
  }

  if (permissionMode === 'acceptEdits') {
    return 'acceptEdits';
  }

  if (permissionMode === 'plan') {
    return 'plan';
  }

  return 'default';
}

async function spawnRipperdoc(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      permissionMode = 'default',
      toolsSettings = {},
    } = options;

    const ripperdocPath = process.env.RIPPERDOC_PATH || 'ripperdoc';
    const workingDir = cwd || projectPath || process.cwd();
    try {
      const stats = fs.statSync(workingDir);
      if (!stats.isDirectory()) {
        throw new Error(`Not a directory: ${workingDir}`);
      }
    } catch (error) {
      const message = `Ripperdoc working directory does not exist: ${workingDir}`;
      sendMessage(ws, {
        type: 'ripperdoc-error',
        sessionId: sessionId || null,
        error: message,
      });
      reject(new Error(message));
      return;
    }
    const effectivePermissionMode = resolvePermissionMode(permissionMode, toolsSettings);

    const args = ['--output-format', 'stream-json', '--permission-mode', effectivePermissionMode];

    if (model) {
      args.push('--model', model);
    }

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    if (command && command.trim()) {
      args.push('--prompt', command.trim());
    }

    const allowedTools = Array.isArray(toolsSettings?.allowedTools)
      ? toolsSettings.allowedTools
      : [];
    const disallowedTools = Array.isArray(toolsSettings?.disallowedTools)
      ? toolsSettings.disallowedTools
      : [];

    if (allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    if (disallowedTools.length > 0) {
      args.push('--disallowedTools', disallowedTools.join(','));
    }

    console.log('[Ripperdoc] Spawning:', ripperdocPath, args.join(' '));
    console.log('[Ripperdoc] Working directory:', workingDir);

    // Launch ripperdoc directly to avoid depending on a shell binary in PATH.
    const proc = spawnFunction(ripperdocPath, args, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let processKey = capturedSessionId || `ripperdoc_${Date.now()}`;
    let stdoutBuffer = '';

    activeRipperdocProcesses.set(processKey, proc);

    const registerSessionId = (nextSessionId) => {
      if (!nextSessionId || nextSessionId === capturedSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;

      if (processKey !== nextSessionId) {
        activeRipperdocProcesses.delete(processKey);
        processKey = nextSessionId;
        activeRipperdocProcesses.set(processKey, proc);
      }

      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(nextSessionId);
      }
    };

    const emitSessionCreated = (nextSessionId) => {
      if (!nextSessionId || sessionCreatedSent || sessionId) {
        return;
      }

      sessionCreatedSent = true;
      sendMessage(ws, {
        type: 'session-created',
        sessionId: nextSessionId,
        provider: 'ripperdoc',
      });
    };

    const handleStreamLine = (line) => {
      if (!line.trim()) {
        return;
      }

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        sendMessage(ws, {
          type: 'ripperdoc-output',
          data: line,
          sessionId: capturedSessionId || sessionId || null,
        });
        return;
      }

      const normalizedEvent = normalizeStreamEvent(event);
      const eventSessionId =
        normalizedEvent.session_id || normalizedEvent.sessionId || normalizedEvent?.data?.session_id;

      if (eventSessionId) {
        registerSessionId(eventSessionId);
        emitSessionCreated(eventSessionId);
      }

      if (normalizedEvent.type === 'system' && normalizedEvent.subtype === 'init' && normalizedEvent.session_id) {
        registerSessionId(normalizedEvent.session_id);
        emitSessionCreated(normalizedEvent.session_id);

        sendMessage(ws, {
          type: 'claude-response',
          sessionId: capturedSessionId || sessionId || null,
          data: normalizedEvent,
        });
        return;
      }

      if (normalizedEvent.type === 'assistant' || normalizedEvent.type === 'user') {
        sendMessage(ws, {
          type: 'claude-response',
          sessionId: capturedSessionId || sessionId || null,
          data: normalizedEvent,
        });
        return;
      }

      if (normalizedEvent.type === 'result') {
        if (normalizedEvent.usage) {
          const usage = normalizedEvent.usage;
          const totalUsed =
            (usage.input_tokens || 0) +
            (usage.output_tokens || 0) +
            (usage.cache_creation_input_tokens || 0) +
            (usage.cache_read_input_tokens || 0);
          const contextWindow = parseInt(process.env.RIPPERDOC_CONTEXT_WINDOW || process.env.CONTEXT_WINDOW || '200000', 10);

          sendMessage(ws, {
            type: 'token-budget',
            sessionId: capturedSessionId || sessionId || null,
            data: {
              used: totalUsed,
              total: Number.isFinite(contextWindow) ? contextWindow : 200000,
              breakdown: {
                input: usage.input_tokens || 0,
                output: usage.output_tokens || 0,
                cacheCreation: usage.cache_creation_input_tokens || 0,
                cacheRead: usage.cache_read_input_tokens || 0,
              },
            },
          });
        }

        sendMessage(ws, {
          type: 'ripperdoc-result',
          sessionId: capturedSessionId || sessionId || null,
          data: normalizedEvent,
        });
        return;
      }

      if (normalizedEvent.type === 'control_response' && normalizedEvent.response?.subtype === 'error') {
        sendMessage(ws, {
          type: 'ripperdoc-error',
          sessionId: capturedSessionId || sessionId || null,
          error: normalizedEvent.response?.error || 'Ripperdoc control error',
        });
        return;
      }

      if (normalizedEvent.type === 'error') {
        sendMessage(ws, {
          type: 'ripperdoc-error',
          sessionId: capturedSessionId || sessionId || null,
          error: normalizedEvent.error || normalizedEvent.message || 'Ripperdoc error',
        });
        return;
      }

      sendMessage(ws, {
        type: 'ripperdoc-response',
        sessionId: capturedSessionId || sessionId || null,
        data: normalizedEvent,
      });
    };

    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      lines.forEach((line) => handleStreamLine(line));
    });

    proc.stderr.on('data', (chunk) => {
      const errorText = chunk.toString().trim();
      if (!errorText) {
        return;
      }

      console.error('[Ripperdoc] stderr:', errorText);
      sendMessage(ws, {
        type: 'ripperdoc-error',
        sessionId: capturedSessionId || sessionId || null,
        error: errorText,
      });
    });

    proc.on('close', (code, signal) => {
      activeRipperdocProcesses.delete(processKey);

      if (stdoutBuffer.trim()) {
        handleStreamLine(stdoutBuffer.trim());
        stdoutBuffer = '';
      }

      const finalSessionId = capturedSessionId || sessionId || processKey;
      sendMessage(ws, {
        type: 'claude-complete',
        sessionId: finalSessionId,
        exitCode: code,
        signal,
        provider: 'ripperdoc',
      });

      if (code === 0 || proc.__ripperdocAborted) {
        resolve();
        return;
      }

      reject(new Error(`Ripperdoc CLI exited with code ${code}`));
    });

    proc.on('error', (error) => {
      activeRipperdocProcesses.delete(processKey);
      sendMessage(ws, {
        type: 'ripperdoc-error',
        sessionId: capturedSessionId || sessionId || null,
        error: error.message,
      });
      reject(error);
    });
  });
}

function abortRipperdocSession(sessionId) {
  const proc = activeRipperdocProcesses.get(sessionId);
  if (!proc) {
    return false;
  }

  proc.__ripperdocAborted = true;

  try {
    proc.kill('SIGTERM');
  } catch {
    return false;
  }

  setTimeout(() => {
    if (activeRipperdocProcesses.get(sessionId) === proc) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore hard-kill failures.
      }
    }
  }, 5000);

  return true;
}

function isRipperdocSessionActive(sessionId) {
  return activeRipperdocProcesses.has(sessionId);
}

function getActiveRipperdocSessions() {
  return Array.from(activeRipperdocProcesses.keys());
}

export {
  spawnRipperdoc,
  abortRipperdocSession,
  isRipperdocSessionActive,
  getActiveRipperdocSessions,
};
