import type { MessageKey } from '../i18n/catalog';

/**
 * Every command the app knows, with its default keybindings ("Mod" = Ctrl, or
 * Cmd on macOS). This list is static so the Keyboard Shortcuts page can show
 * everything; *handlers* are registered at runtime by whichever component can
 * run the command right now (see registry.ts), and the palette only offers
 * commands that currently have one. Ids follow VS Code where one exists.
 */
export interface CommandSpec {
  id: string;
  title: MessageKey;
  category: MessageKey;
  keys: readonly string[];
  /**
   * macOS defaults when they differ. Option+letter types characters there
   * (Option+L = "¬", Option+N is a dead key), so Alt+ defaults move to Ctrl+.
   */
  macKeys?: readonly string[];
  /** Where the command is available, for the shortcuts page; omitted = everywhere. */
  when?: MessageKey;
  /** Runs again while the key is held (auto-repeat); off for everything else. */
  repeatable?: boolean;
}

export const COMMANDS = [
  {
    id: 'workbench.action.showCommands',
    title: 'cmd.showCommands',
    category: 'cmdCategory.view',
    keys: ['Mod+Shift+P', 'F1'],
  },
  {
    id: 'workbench.action.quickOpen',
    title: 'cmd.quickOpen',
    category: 'cmdCategory.go',
    keys: ['Mod+P'],
  },
  {
    id: 'workbench.action.openGlobalKeybindings',
    title: 'cmd.openKeybindings',
    category: 'cmdCategory.preferences',
    keys: ['Mod+K Mod+S'],
  },
  {
    id: 'workbench.action.toggleSidebarVisibility',
    title: 'cmd.toggleSidebar',
    category: 'cmdCategory.view',
    keys: ['Mod+B'],
  },
  {
    id: 'km.auth.signOut',
    title: 'cmd.signOut',
    category: 'cmdCategory.account',
    keys: [],
  },
  {
    id: 'km.sidebar.focusSearch',
    title: 'cmd.focusSearch',
    category: 'cmdCategory.view',
    keys: ['Mod+Shift+F'],
  },
  {
    id: 'km.go.graph',
    title: 'cmd.goGraph',
    category: 'cmdCategory.go',
    keys: ['Alt+1'],
    macKeys: ['Ctrl+1'],
  },
  {
    id: 'km.go.tags',
    title: 'cmd.goTags',
    category: 'cmdCategory.go',
    keys: ['Alt+2'],
    macKeys: ['Ctrl+2'],
  },
  {
    id: 'km.go.review',
    title: 'cmd.goReview',
    category: 'cmdCategory.go',
    keys: ['Alt+3'],
    macKeys: ['Ctrl+3'],
  },
  {
    id: 'km.node.new',
    title: 'cmd.newNode',
    category: 'cmdCategory.node',
    keys: ['Alt+N'],
    macKeys: ['Ctrl+Alt+N'],
  },
  {
    id: 'km.local.saveToFile',
    title: 'cmd.saveLocalToFile',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.local.openFromFile',
    title: 'cmd.openLocalFromFile',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.local.stopSaving',
    title: 'cmd.stopSavingToFile',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.backup.exportMarkdown',
    title: 'cmd.exportMarkdown',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.sync.open',
    title: 'cmd.sync',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.sync.push',
    title: 'cmd.syncPush',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.sync.pull',
    title: 'cmd.syncPull',
    category: 'cmdCategory.data',
    keys: [],
  },
  {
    id: 'km.language.change',
    title: 'cmd.changeLanguage',
    category: 'cmdCategory.preferences',
    keys: [],
  },
  {
    id: 'km.node.rename',
    title: 'cmd.renameNode',
    category: 'cmdCategory.node',
    keys: ['F2'],
    when: 'cmdWhen.node',
  },
  {
    // Vim-ish: K = up to the title, J = down into the content.
    id: 'km.node.focusTitle',
    title: 'cmd.focusTitle',
    category: 'cmdCategory.node',
    keys: ['Alt+K'],
    macKeys: ['Ctrl+Alt+K'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.focusContent',
    title: 'cmd.focusContent',
    category: 'cmdCategory.node',
    keys: ['Alt+J'],
    macKeys: ['Ctrl+Alt+J'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.editor.toggleVim',
    title: 'cmd.toggleVim',
    category: 'cmdCategory.preferences',
    keys: [],
  },
  {
    id: 'km.node.addLink',
    title: 'cmd.addLink',
    category: 'cmdCategory.node',
    keys: ['Alt+L'],
    macKeys: ['Ctrl+Alt+L'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.addTag',
    title: 'cmd.addTag',
    category: 'cmdCategory.node',
    keys: ['Alt+G'],
    macKeys: ['Ctrl+Alt+G'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.whys',
    title: 'cmd.openWhys',
    category: 'cmdCategory.node',
    keys: ['Alt+W'],
    macKeys: ['Ctrl+Alt+W'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.whysCopyPrompt',
    title: 'cmd.copyWhysPrompt',
    category: 'cmdCategory.node',
    keys: ['Alt+Shift+W'],
    macKeys: ['Ctrl+Alt+Shift+W'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.copyLinkCheckPrompt',
    title: 'cmd.copyLinkCheckPrompt',
    category: 'cmdCategory.node',
    keys: ['Alt+Shift+L'],
    macKeys: ['Ctrl+Alt+Shift+L'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.node.delete',
    title: 'cmd.deleteNode',
    category: 'cmdCategory.node',
    keys: [],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.markdown.togglePreview',
    title: 'cmd.togglePreview',
    category: 'cmdCategory.markdown',
    // Not Mod+Shift+V: that's the browser's "paste as plain text".
    keys: ['Mod+K Mod+V'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.markdown.showEditor',
    title: 'cmd.showEditor',
    category: 'cmdCategory.markdown',
    keys: ['Mod+K E'],
    when: 'cmdWhen.node',
  },
  {
    id: 'km.markdown.openPreviewToSide',
    title: 'cmd.previewToSide',
    category: 'cmdCategory.markdown',
    keys: ['Mod+K V'],
    when: 'cmdWhen.node',
  },
  {
    // F2 is taken by Rename Node (defaults may not clash, whatever the page).
    id: 'km.edge.rename',
    title: 'cmd.renameLink',
    category: 'cmdCategory.graph',
    keys: [],
    when: 'cmdWhen.graph',
  },
  {
    id: 'km.graph.toggle3d',
    title: 'cmd.toggle3d',
    category: 'cmdCategory.graph',
    keys: ['Shift+3'],
    when: 'cmdWhen.graph',
  },
  {
    id: 'km.settings.export',
    title: 'cmd.exportSettings',
    category: 'cmdCategory.preferences',
    keys: [],
  },
  {
    id: 'km.settings.import',
    title: 'cmd.importSettings',
    category: 'cmdCategory.preferences',
    keys: [],
  },
  {
    id: 'km.graph.toggleSettings',
    title: 'cmd.graphSettings',
    category: 'cmdCategory.graph',
    keys: [],
    when: 'cmdWhen.graph',
  },
  {
    id: 'km.graph.fitView',
    title: 'cmd.fitView',
    category: 'cmdCategory.graph',
    keys: ['Shift+1'],
    when: 'cmdWhen.graph',
  },
  {
    id: 'km.graph.zoomIn',
    title: 'cmd.zoomIn',
    category: 'cmdCategory.graph',
    // "=", "+" (Shift+= on US layouts) and the keypad +.
    keys: ['=', 'Shift+=', 'Plus'],
    when: 'cmdWhen.graph',
    repeatable: true,
  },
  {
    id: 'km.graph.zoomOut',
    title: 'cmd.zoomOut',
    category: 'cmdCategory.graph',
    keys: ['-'],
    when: 'cmdWhen.graph',
    repeatable: true,
  },
  {
    id: 'km.tags.new',
    title: 'cmd.newTag',
    category: 'cmdCategory.tags',
    keys: ['Alt+Shift+N'],
    macKeys: ['Ctrl+Alt+Shift+N'],
    when: 'cmdWhen.tags',
  },
] as const satisfies readonly CommandSpec[];

export type CommandId = (typeof COMMANDS)[number]['id'];

/** The same list, widened so optional fields (`when`, `macKeys`) are readable. */
export const COMMAND_LIST: readonly (CommandSpec & { id: CommandId })[] = COMMANDS;

export const COMMAND_BY_ID: ReadonlyMap<CommandId, CommandSpec> = new Map(
  COMMAND_LIST.map((c) => [c.id, c]),
);

export function isCommandId(id: string): id is CommandId {
  return COMMAND_BY_ID.has(id as CommandId);
}

/**
 * Browser/editing shortcuts a default must never take (as a whole press or a
 * chord's first press): clipboard, undo, select all, tabs/windows, reload,
 * address bar, find.
 */
export const BROWSER_RESERVED = [
  'Mod+A',
  'Mod+C',
  'Mod+V',
  'Mod+X',
  'Mod+Z',
  'Mod+Y',
  'Mod+F',
  'Mod+L',
  'Mod+N',
  'Mod+Q',
  'Mod+R',
  'Mod+T',
  'Mod+W',
  'Mod+Shift+N',
  'Mod+Shift+T',
  'Mod+Shift+V',
  'Mod+Shift+W',
  'Mod+Shift+Z',
] as const;
