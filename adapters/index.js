/**
 * Tool adapters — 每个 AI 编码工具的适配配置
 *
 * 每个 adapter 定义：
 *   - promptPath: 提示词文件相对项目根目录的路径
 *   - commandsDir: 原生命令目录（null = 无原生命令支持）
 *   - detect(projectRoot): 自动检测该工具是否在使用
 *   - formatPrompt(content): 将通用 prompt 转换为工具专属格式
 *   - formatCommand(content, meta): 将通用命令转换为工具专属格式
 *   - cleanupPaths: uninstall 时需清理的路径（相对项目根）
 */

const fs = require('fs');
const path = require('path');

/**
 * 移除 markdown 文件的 YAML frontmatter（--- 开始结束）
 * 用于在 install agent 时去掉框架的元数据后插入宿主期望的格式
 */
function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length) : content;
}

/**
 * 解析 markdown frontmatter 提取 name / role / tools 等元数据
 * 用于生成宿主专属 agent 文件的描述与权限
 *
 * 支持的字段：name, role, when_to_use, trigger_phase, needs_subagent, tools
 * tools 字段格式："read,grep,glob,bash"（逗号分隔），未指定则使用宿主默认
 */
function parseAgentMeta(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', role: '', when_to_use: '' };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  // tools 转成数组
  if (meta.tools && typeof meta.tools === 'string') {
    meta.tools = meta.tools.split(',').map(s => s.trim()).filter(Boolean);
  }
  return meta;
}

/**
 * opencode agent frontmatter 模板
 * 当前 opencode 文档使用 .opencode/agents/*.md，并用 permission 控制工具权限。
 * 文档：https://opencode.ai/docs/agents/
 */
function buildOpencodeAgentFrontmatter(meta) {
  // 默认只读工具集；profile 可在 tools 字段显式声明（如 ["read","write","edit"]）
  const defaultTools = ['read', 'grep', 'glob', 'bash'];
  const requested = (meta.tools && meta.tools.length > 0) ? meta.tools : defaultTools;
  const allTools = ['read', 'grep', 'glob', 'bash', 'write', 'edit'];
  const permissionLines = allTools.map(t => `  ${t}: ${requested.includes(t) ? 'allow' : 'deny'}`);
  return [
    '---',
    `description: ${meta.role || meta.name}`,
    'mode: subagent',
    'permission:',
    ...permissionLines,
    '---',
    '',
  ].join('\n');
}

/**
 * Claude Code agent frontmatter 模板
 * 最后验证版本：Claude Code 1.x（如 schema 改变需更新此处）
 */
function buildClaudeCodeAgentFrontmatter(meta) {
  // Claude Code 工具名首字母大写
  const toolMap = { read: 'Read', grep: 'Grep', glob: 'Glob', bash: 'Bash', write: 'Write', edit: 'Edit' };
  const defaultTools = ['read', 'grep', 'glob', 'bash'];
  const requested = (meta.tools && meta.tools.length > 0) ? meta.tools : defaultTools;
  const toolsStr = requested.map(t => toolMap[t] || t).join(', ');
  return [
    '---',
    `name: ${meta.name}`,
    `description: ${meta.role || meta.name}`,
    `tools: ${toolsStr}`,
    '---',
    '',
  ].join('\n');
}

// ─── 命令路由模板（无原生命令的工具追加到 prompt 末尾） ───────

function buildCommandRoutingSection() {
  return `

---

## 命令路由

当用户输入以下命令时，读取对应文件并按其指令执行：

| 命令 | 读取文件 |
|------|---------|
| \`/spec:init\` | \`spec_copilot/commands/spec/init.md\` |
| \`/spec:bootstrap\` | \`spec_copilot/commands/spec/bootstrap.md\` |
| \`/spec:propose <需求>\` | \`spec_copilot/commands/spec/propose.md\` |
| \`/spec:lite <需求>\` | \`spec_copilot/commands/spec/lite.md\` |
| \`/spec:flow <需求>\` | \`spec_copilot/commands/spec/flow.md\` |
| \`/spec:apply <变更名>\` | \`spec_copilot/commands/spec/apply.md\` |
| \`/spec:smoke <变更名>\` | \`spec_copilot/commands/spec/smoke.md\` |
| \`/spec:review <变更名>\` | \`spec_copilot/commands/spec/review.md\` |
| \`/spec:agent-check\` | \`spec_copilot/commands/spec/agent-check.md\` |
| \`/spec:fix <变更名>\` | \`spec_copilot/commands/spec/fix.md\` |
| \`/spec:test <变更名>\` | \`spec_copilot/commands/spec/test.md\` |
| \`/spec:archive <变更名>\` | \`spec_copilot/commands/spec/archive.md\` |
| \`/spec:hotfix <描述>\` | \`spec_copilot/commands/spec/hotfix.md\` |

用户输入命令后，**立即**读取对应文件并执行，不需要再次确认。
将 \`<需求>\`、\`<变更名>\`、\`<描述>\` 替换为用户在命令后提供的参数。
`;
}

// ─── Adapters ───────────────────────────────────────────────

const adapters = {

  // ─── opencode ────────────────────────────────────────────
  opencode: {
    name: 'opencode',
    displayName: 'opencode',
    description: 'opencode CLI (github.com/opencode-ai/opencode)',
    promptPath: 'AGENTS.md',
    commandsDir: '.opencode/commands',
    hasNativeCommands: true,
    agentsDir: '.opencode/agents',
    legacyAgentsDir: '.opencode/agent',
    supportsSubagent: true,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.opencode')) ||
             fs.existsSync(path.join(projectRoot, 'opencode.json'));
    },

    formatPrompt(content) {
      return content;
    },

    formatCommand(content, _meta) {
      return content;
    },

    /**
     * 把 framework/agents/<name>.md 转成 opencode 子 agent 格式
     * 移除原有 YAML 前置数据，替换为 opencode 期望的 frontmatter
     */
    formatAgent(content, meta) {
      return buildOpencodeAgentFrontmatter(meta) + stripFrontmatter(content);
    },

    // 注意：.opencode/agent 不整体删除，由 cli.js 按 agent 文件名精准清理（保护用户自建 agent）
    cleanupPaths: ['AGENTS.md', '.opencode/commands'],
  },

  // ─── Claude Code ─────────────────────────────────────────
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    description: 'Claude Code CLI (Anthropic)',
    promptPath: 'CLAUDE.md',
    commandsDir: '.claude/commands',
    hasNativeCommands: true,
    agentsDir: '.claude/agents',
    supportsSubagent: true,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.claude')) ||
             fs.existsSync(path.join(projectRoot, 'CLAUDE.md'));
    },

    formatPrompt(content) {
      return content;
    },

    formatCommand(content, _meta) {
      return content;
    },

    formatAgent(content, meta) {
      return buildClaudeCodeAgentFrontmatter(meta) + stripFrontmatter(content);
    },

    // 注意：.claude/agents 不整体删除，由 cli.js 按 agent 文件名精准清理（保护用户自建 agent）
    cleanupPaths: ['CLAUDE.md', '.claude/commands'],
  },

  // ─── Cursor ──────────────────────────────────────────────
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    description: 'Cursor IDE (.cursor/rules/*.mdc)',
    promptPath: '.cursor/rules/spec-copilot.mdc',
    legacyPath: '.cursorrules',           // 根目录 legacy 文件
    commandsDir: null, // commands go to spec_copilot/commands/
    hasNativeCommands: false,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.cursor')) ||
             fs.existsSync(path.join(projectRoot, '.cursorrules'));
    },

    formatPrompt(content) {
      const frontmatter = [
        '---',
        'description: "Spec-Driven Development Framework — AI 编码协作规范"',
        'alwaysApply: true',
        '---',
        '',
      ].join('\n');
      return frontmatter + content + buildCommandRoutingSection();
    },

    formatLegacy(content) {
      return content + buildCommandRoutingSection();
    },

    formatCommand(content, _meta) {
      return content; // stored in spec_copilot/commands/, not tool-specific
    },

    cleanupPaths: ['.cursor/rules/spec-copilot.mdc', '.cursorrules'],
  },

  // ─── Windsurf ────────────────────────────────────────────
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    description: 'Windsurf IDE (.windsurf/rules/)',
    promptPath: '.windsurf/rules/spec-copilot.md',
    legacyPath: '.windsurfrules',          // 根目录 legacy 文件
    commandsDir: null,
    hasNativeCommands: false,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.windsurf')) ||
             fs.existsSync(path.join(projectRoot, '.windsurfrules'));
    },

    formatPrompt(content) {
      return content + buildCommandRoutingSection();
    },

    formatLegacy(content) {
      return content + buildCommandRoutingSection();
    },

    formatCommand(content, _meta) {
      return content;
    },

    cleanupPaths: ['.windsurf/rules/spec-copilot.md', '.windsurfrules'],
  },

  // ─── GitHub Copilot ──────────────────────────────────────
  copilot: {
    name: 'copilot',
    displayName: 'GitHub Copilot',
    description: 'GitHub Copilot (.github/copilot-instructions.md)',
    promptPath: '.github/copilot-instructions.md',
    commandsDir: null,
    hasNativeCommands: false,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.github', 'copilot-instructions.md'));
    },

    formatPrompt(content) {
      return content + buildCommandRoutingSection();
    },

    formatCommand(content, _meta) {
      return content;
    },

    cleanupPaths: ['.github/copilot-instructions.md'],
  },

  // ─── Cline ───────────────────────────────────────────────
  cline: {
    name: 'cline',
    displayName: 'Cline',
    description: 'Cline VSCode extension (.clinerules/)',
    promptPath: '.clinerules/spec-copilot.md',
    commandsDir: null,
    hasNativeCommands: false,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.clinerules')) ||
             fs.existsSync(path.join(projectRoot, '.cline'));
    },

    formatPrompt(content) {
      return content + buildCommandRoutingSection();
    },

    formatCommand(content, _meta) {
      return content;
    },

    cleanupPaths: ['.clinerules/spec-copilot.md'],
  },

};

/** 自动检测项目中使用的工具 */
function detectTools(projectRoot) {
  return Object.values(adapters).filter(a => a.detect(projectRoot));
}

/** 获取所有支持的工具名 */
function supportedTools() {
  return Object.keys(adapters);
}

/**
 * 自动检测项目技术栈，返回结构化信息
 * 用于在生成提示词时注入项目特定上下文
 */
function detectStack(projectRoot) {
  const stack = { frontend: null, backend: null, language: [], buildTool: null, packageManager: null, db: null, extras: [] };

  // ─── 前端检测 ───
  const pkgPath = path.join(projectRoot, 'package.json');
  let pkg = null;
  if (fs.existsSync(pkgPath)) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch {}
  }
  // 可能在子目录
  if (!pkg) {
    for (const sub of ['frontend', 'web', 'client', 'app']) {
      const p = path.join(projectRoot, sub, 'package.json');
      if (fs.existsSync(p)) {
        try { pkg = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
        if (pkg) break;
      }
    }
  }
  if (pkg) {
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps.vue || allDeps['@vue/cli-service'] || allDeps.nuxt) {
      stack.frontend = allDeps.nuxt ? 'Nuxt' : (allDeps.vue && allDeps.vue.startsWith('^3') ? 'Vue 3' : 'Vue');
    } else if (allDeps.react || allDeps['react-dom'] || allDeps.next) {
      stack.frontend = allDeps.next ? 'Next.js' : 'React';
    } else if (allDeps['@angular/core']) {
      stack.frontend = 'Angular';
    } else if (allDeps.svelte || allDeps['@sveltejs/kit']) {
      stack.frontend = 'Svelte';
    }
    if (allDeps.typescript) stack.language.push('TypeScript');
    if (allDeps.tailwindcss) stack.extras.push('Tailwind CSS');
    if (allDeps['element-plus'] || allDeps['element-ui']) stack.extras.push('Element UI');
    if (allDeps['ant-design-vue'] || allDeps.antd) stack.extras.push('Ant Design');
    if (allDeps.vite) stack.buildTool = 'Vite';
    else if (allDeps.webpack) stack.buildTool = 'webpack';
    // package manager
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) stack.packageManager = 'pnpm';
    else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) stack.packageManager = 'yarn';
    else stack.packageManager = 'npm';
  }

  // ─── 后端检测 ───
  const pomPaths = [path.join(projectRoot, 'pom.xml'), path.join(projectRoot, 'backend', 'pom.xml'), path.join(projectRoot, 'server', 'pom.xml')];
  const gradlePaths = [path.join(projectRoot, 'build.gradle'), path.join(projectRoot, 'build.gradle.kts'), path.join(projectRoot, 'backend', 'build.gradle')];
  if (pomPaths.some(p => fs.existsSync(p))) {
    stack.backend = 'Spring Boot';
    stack.language.push('Java');
  } else if (gradlePaths.some(p => fs.existsSync(p))) {
    stack.backend = 'Spring Boot (Gradle)';
    if (!stack.language.includes('Java')) stack.language.push('Java');
  } else if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    stack.backend = 'Go';
    stack.language.push('Go');
  } else if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) || fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    stack.backend = 'Python';
    stack.language.push('Python');
    if (fs.existsSync(path.join(projectRoot, 'manage.py'))) stack.backend = 'Django';
  } else if (pkg && !stack.frontend) {
    // Node.js backend (Express, Nest, etc.)
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps.express) { stack.backend = 'Express'; stack.language.push('Node.js'); }
    else if (allDeps['@nestjs/core']) { stack.backend = 'NestJS'; stack.language.push('Node.js'); }
  }

  // ─── 数据库检测 ───
  if (pkg) {
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps.mysql2 || allDeps.mysql) stack.db = 'MySQL';
    else if (allDeps.pg) stack.db = 'PostgreSQL';
    else if (allDeps.mongodb || allDeps.mongoose) stack.db = 'MongoDB';
  }

  // 去重 language
  stack.language = [...new Set(stack.language)];
  return stack;
}

/**
 * 根据检测到的技术栈生成项目上下文摘要
 * 注入到适配器生成的提示词中
 */
function buildStackContext(stack) {
  const parts = [];
  if (stack.frontend) parts.push(`前端: ${stack.frontend}`);
  if (stack.backend) parts.push(`后端: ${stack.backend}`);
  if (stack.language.length > 0) parts.push(`语言: ${stack.language.join(', ')}`);
  if (stack.buildTool) parts.push(`构建: ${stack.buildTool}`);
  if (stack.packageManager) parts.push(`包管理: ${stack.packageManager}`);
  if (stack.db) parts.push(`数据库: ${stack.db}`);
  if (stack.extras.length > 0) parts.push(`UI/CSS: ${stack.extras.join(', ')}`);

  if (parts.length === 0) return '';

  return `
## 项目技术栈（自动检测）

${parts.map(p => `- ${p}`).join('\n')}

> 以上技术栈由 spec-copilot 自动检测，请结合项目实际情况编码。
`;
}

module.exports = { adapters, detectTools, supportedTools, buildCommandRoutingSection, stripFrontmatter, parseAgentMeta, detectStack, buildStackContext };
