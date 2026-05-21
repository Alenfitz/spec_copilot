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

// ─── 命令路由模板（无原生命令的工具追加到 prompt 末尾） ───────

function buildCommandRoutingSection() {
  return `

---

## 命令路由

当用户输入以下命令时，读取对应文件并按其指令执行：

| 命令 | 读取文件 |
|------|---------|
| \`/spec:init\` | \`spec_copilot/commands/spec:init.md\` |
| \`/spec:bootstrap\` | \`spec_copilot/commands/spec:bootstrap.md\` |
| \`/spec:propose <需求>\` | \`spec_copilot/commands/spec:propose.md\` |
| \`/spec:flow <需求>\` | \`spec_copilot/commands/spec:flow.md\` |
| \`/spec:apply <变更名>\` | \`spec_copilot/commands/spec:apply.md\` |
| \`/spec:smoke <变更名>\` | \`spec_copilot/commands/spec:smoke.md\` |
| \`/spec:review <变更名>\` | \`spec_copilot/commands/spec:review.md\` |
| \`/spec:fix <变更名>\` | \`spec_copilot/commands/spec:fix.md\` |
| \`/spec:test <变更名>\` | \`spec_copilot/commands/spec:test.md\` |
| \`/spec:archive <变更名>\` | \`spec_copilot/commands/spec:archive.md\` |
| \`/spec:hotfix <描述>\` | \`spec_copilot/commands/spec:hotfix.md\` |

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

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.opencode')) ||
             fs.existsSync(path.join(projectRoot, 'opencode.json'));
    },

    formatPrompt(content) {
      return content;
    },

    formatCommand(content, _meta) {
      return content; // opencode uses same format as our command files
    },

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

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.claude')) ||
             fs.existsSync(path.join(projectRoot, 'CLAUDE.md'));
    },

    formatPrompt(content) {
      return content;
    },

    formatCommand(content, _meta) {
      return content; // Claude Code uses same frontmatter format
    },

    cleanupPaths: ['CLAUDE.md', '.claude/commands'],
  },

  // ─── Cursor ──────────────────────────────────────────────
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    description: 'Cursor IDE (.cursor/rules/*.mdc)',
    promptPath: '.cursor/rules/spec-copilot.mdc',
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

    formatCommand(content, _meta) {
      return content; // stored in spec_copilot/commands/, not tool-specific
    },

    cleanupPaths: ['.cursor/rules/spec-copilot.mdc'],
  },

  // ─── Windsurf ────────────────────────────────────────────
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    description: 'Windsurf IDE (.windsurf/rules/)',
    promptPath: '.windsurf/rules/spec-copilot.md',
    commandsDir: null,
    hasNativeCommands: false,

    detect(projectRoot) {
      return fs.existsSync(path.join(projectRoot, '.windsurf')) ||
             fs.existsSync(path.join(projectRoot, '.windsurfrules'));
    },

    formatPrompt(content) {
      return content + buildCommandRoutingSection();
    },

    formatCommand(content, _meta) {
      return content;
    },

    cleanupPaths: ['.windsurf/rules/spec-copilot.md'],
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

module.exports = { adapters, detectTools, supportedTools, buildCommandRoutingSection };
