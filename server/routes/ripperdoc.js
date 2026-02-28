import express from 'express';
import { spawn } from 'child_process';

const router = express.Router();

function createCliResponder(res) {
  let responded = false;
  return (status, payload) => {
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    res.status(status).json(payload);
  };
}

function getRipperdocBinary() {
  return process.env.RIPPERDOC_PATH || 'ripperdoc';
}

function scopeToCli(scope) {
  if (scope === 'local' || scope === 'project') {
    return 'project';
  }

  if (scope === 'all') {
    return 'all';
  }

  return 'user';
}

function scopeFromCli(scope) {
  if (scope === 'project' || scope === 'local') {
    return 'local';
  }

  if (scope === 'user') {
    return 'user';
  }

  return scope || 'user';
}

function inferTransport(config = {}) {
  const explicit = String(config.type || config.transport || '').toLowerCase();
  if (explicit === 'stdio' || explicit === 'sse' || explicit === 'http' || explicit === 'streamable-http') {
    return explicit;
  }
  if (config.url || config.uri) {
    return 'http';
  }
  return 'stdio';
}

function projectPathFromConfigPath(configPath) {
  if (!configPath || typeof configPath !== 'string') {
    return undefined;
  }

  if (configPath.endsWith('/.ripperdoc/mcp.json')) {
    return configPath.slice(0, -'/.ripperdoc/mcp.json'.length);
  }

  if (configPath.endsWith('/.mcp.json')) {
    return configPath.slice(0, -'/.mcp.json'.length);
  }

  return undefined;
}

function extractJsonArray(output) {
  const trimmed = String(output || '').trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start < 0 || end <= start) {
      return [];
    }

    try {
      const sliced = trimmed.slice(start, end + 1);
      const parsed = JSON.parse(sliced);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function listRowsToServers(rows) {
  return rows
    .filter((row) => row && typeof row === 'object' && row.name)
    .map((row) => {
      const config = (row.config && typeof row.config === 'object') ? row.config : {};
      const scope = scopeFromCli(row.scope);
      const projectPath = scope === 'local' ? projectPathFromConfigPath(row.config_path || row.configPath) : undefined;

      return {
        id: scope === 'local' ? `local:${row.name}` : row.name,
        name: row.name,
        type: row.transport || inferTransport(config),
        scope,
        projectPath,
        config: {
          command: config.command || '',
          args: Array.isArray(config.args) ? config.args : [],
          env: (config.env && typeof config.env === 'object') ? config.env : {},
          url: config.url || config.uri || '',
          headers: (config.headers && typeof config.headers === 'object') ? config.headers : {},
          timeout: 30000,
        },
        raw: config,
      };
    });
}

function listRowsToCliServers(rows) {
  return rows
    .filter((row) => row && typeof row === 'object' && row.name)
    .map((row) => {
      const config = (row.config && typeof row.config === 'object') ? row.config : {};
      return {
        name: row.name,
        type: row.transport || inferTransport(config),
        scope: scopeFromCli(row.scope),
        command: config.command || '',
        args: Array.isArray(config.args) ? config.args : [],
        env: (config.env && typeof config.env === 'object') ? config.env : {},
        url: config.url || config.uri || '',
        headers: (config.headers && typeof config.headers === 'object') ? config.headers : {},
        config_path: row.config_path || row.configPath || '',
      };
    });
}

function runRipperdocCommand(args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(getRipperdocBinary(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });

    proc.on('error', (error) => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error,
      });
    });
  });
}

router.get('/mcp/cli/list', async (req, res) => {
  const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : process.cwd();
  const result = await runRipperdocCommand(['mcp', 'list', '--json'], { cwd: projectPath });

  if (!result.ok) {
    const missing = result.error?.code === 'ENOENT';
    return res.status(missing ? 503 : 400).json({
      error: missing ? 'Ripperdoc CLI not installed' : 'Ripperdoc MCP list failed',
      details: result.stderr || result.error?.message || `Exited with code ${result.code}`,
    });
  }

  const rows = extractJsonArray(result.stdout);
  return res.json({
    success: true,
    output: result.stdout,
    servers: listRowsToCliServers(rows),
  });
});

router.get('/mcp/config/read', async (req, res) => {
  const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : process.cwd();
  const result = await runRipperdocCommand(['mcp', 'list', '--json'], { cwd: projectPath });

  if (!result.ok) {
    return res.json({
      success: false,
      message: result.stderr || result.error?.message || `Exited with code ${result.code}`,
      servers: [],
    });
  }

  const rows = extractJsonArray(result.stdout);
  return res.json({
    success: true,
    servers: listRowsToServers(rows),
  });
});

router.post('/mcp/cli/add', async (req, res) => {
  const {
    name,
    type = 'stdio',
    scope = 'user',
    projectPath,
    command,
    args = [],
    url,
    headers = {},
    env = {},
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const cliScope = scopeToCli(scope);
  const cliArgs = ['mcp', 'add', '--scope', cliScope];

  if (type === 'http' || type === 'sse' || type === 'streamable-http') {
    if (!url || !String(url).trim()) {
      return res.status(400).json({ error: 'url is required for HTTP/SSE MCP servers' });
    }

    cliArgs.push('--transport', type, String(name).trim(), String(url).trim());
  } else {
    if (!command || !String(command).trim()) {
      return res.status(400).json({ error: 'command is required for stdio MCP servers' });
    }

    cliArgs.push(String(name).trim(), String(command).trim());

    if (Array.isArray(args) && args.length > 0) {
      cliArgs.push(...args.map((item) => String(item)));
    }
  }

  if (env && typeof env === 'object') {
    Object.entries(env).forEach(([key, value]) => {
      cliArgs.push('-e', `${key}=${value}`);
    });
  }

  if ((type === 'http' || type === 'sse' || type === 'streamable-http') && headers && typeof headers === 'object') {
    Object.entries(headers).forEach(([key, value]) => {
      cliArgs.push('--header', `${key}: ${value}`);
    });
  }

  const cwd = cliScope === 'project' && typeof projectPath === 'string' && projectPath.trim()
    ? projectPath
    : process.cwd();

  const result = await runRipperdocCommand(cliArgs, { cwd });
  if (!result.ok) {
    const missing = result.error?.code === 'ENOENT';
    return res.status(missing ? 503 : 400).json({
      error: missing ? 'Ripperdoc CLI not installed' : 'Ripperdoc MCP add failed',
      details: result.stderr || result.error?.message || `Exited with code ${result.code}`,
    });
  }

  return res.json({
    success: true,
    output: result.stdout,
    message: `MCP server "${name}" added successfully`,
  });
});

router.post('/mcp/cli/add-json', async (req, res) => {
  const { name, jsonConfig, scope = 'user', projectPath } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  let parsed;
  try {
    parsed = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
  } catch (error) {
    return res.status(400).json({ error: 'Invalid JSON configuration', details: error.message });
  }

  if (!parsed || typeof parsed !== 'object') {
    return res.status(400).json({ error: 'JSON configuration must be an object' });
  }

  const cliScope = scopeToCli(scope);
  const cliArgs = ['mcp', 'add-json', '--scope', cliScope, String(name).trim(), JSON.stringify(parsed)];
  const cwd = cliScope === 'project' && typeof projectPath === 'string' && projectPath.trim()
    ? projectPath
    : process.cwd();
  const result = await runRipperdocCommand(cliArgs, { cwd });

  if (!result.ok) {
    const missing = result.error?.code === 'ENOENT';
    return res.status(missing ? 503 : 400).json({
      error: missing ? 'Ripperdoc CLI not installed' : 'Ripperdoc MCP add-json failed',
      details: result.stderr || result.error?.message || `Exited with code ${result.code}`,
    });
  }

  return res.json({
    success: true,
    output: result.stdout,
    message: `MCP server "${name}" added successfully via JSON`,
  });
});

router.delete('/mcp/cli/remove/:name', async (req, res) => {
  const respond = createCliResponder(res);
  const incomingName = String(req.params.name || '');
  const queryScope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined;

  let actualName = incomingName;
  let scope = queryScope;

  if (incomingName.includes(':')) {
    const [prefix, ...rest] = incomingName.split(':');
    if (rest.length > 0) {
      actualName = rest.join(':');
      scope = scope || prefix;
    }
  }

  const cliScope = scopeToCli(scope);
  const cliArgs = ['mcp', 'remove', '--scope', cliScope, actualName];
  const cwd = cliScope === 'project' && projectPath ? projectPath : process.cwd();

  const result = await runRipperdocCommand(cliArgs, { cwd });
  if (!result.ok) {
    const missing = result.error?.code === 'ENOENT';
    respond(missing ? 503 : 400, {
      error: missing ? 'Ripperdoc CLI not installed' : 'Ripperdoc MCP remove failed',
      details: result.stderr || result.error?.message || `Exited with code ${result.code}`,
    });
    return;
  }

  respond(200, {
    success: true,
    output: result.stdout,
    message: `MCP server "${incomingName}" removed successfully`,
  });
});

router.get('/mcp/cli/get/:name', async (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : process.cwd();
  const result = await runRipperdocCommand(['mcp', 'get', name, '--json'], { cwd: projectPath });

  if (!result.ok) {
    const missing = result.error?.code === 'ENOENT';
    return res.status(missing ? 503 : 404).json({
      error: missing ? 'Ripperdoc CLI not installed' : 'Ripperdoc MCP get failed',
      details: result.stderr || result.error?.message || `Exited with code ${result.code}`,
    });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }

  return res.json({
    success: true,
    output: result.stdout,
    server: parsed,
  });
});

export default router;
