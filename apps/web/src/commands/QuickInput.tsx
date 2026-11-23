import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGraph } from '../api/queries';
import { useI18n } from '../i18n/context';
import { COMMANDS, isCommandId, type CommandId } from './catalog';
import { fuzzyFilter } from './fuzzy';
import { useBindings } from './keybindingStore';
import type { Keybinding } from './keybinding';
import { Keys } from './Keys';
import { closeQuickInput, useQuickInput, type CustomPick } from './quickInputStore';
import { runCommand, useAvailableCommands } from './registry';
import { readJson, writeJson } from './storage';

const COMMAND_PREFIX = '>';
const MAX_ROWS = 100;
const RECENT_KEY = 'km.recentCommands';
const MAX_RECENT = 8;

interface Row {
  key: string;
  label: string;
  indices: readonly number[];
  description?: string;
  binding?: Keybinding;
  badge?: string;
  run: () => void;
}

function readRecent(): CommandId[] {
  const raw = readJson(RECENT_KEY);
  return Array.isArray(raw)
    ? raw.filter((id): id is CommandId => typeof id === 'string' && isCommandId(id))
    : [];
}

function rememberRecent(id: CommandId): void {
  writeJson(RECENT_KEY, [id, ...readRecent().filter((r) => r !== id)].slice(0, MAX_RECENT));
}

/** VS Code's quick input: ">" + text lists commands, plain text lists nodes. */
export function QuickInput() {
  const state = useQuickInput();
  if (!state.open) return null;
  // Keyed by session: every open starts fresh (value, selection, focus).
  return (
    <QuickInputBox
      key={state.session}
      initialValue={state.initialValue}
      custom={state.custom}
      returnFocus={state.returnFocus}
    />
  );
}

function Highlighted({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  return <>{Array.from(text).map((c, i) => (marked.has(i) ? <mark key={i}>{c}</mark> : c))}</>;
}

function QuickInputBox({
  initialValue,
  custom,
  returnFocus,
}: {
  initialValue: string;
  custom: CustomPick | null;
  returnFocus: Element | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const available = useAvailableCommands();
  const bindings = useBindings();
  const graph = useGraph();
  const [value, setValue] = useState(initialValue);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const commandMode = custom === null && value.startsWith(COMMAND_PREFIX);
  const query = commandMode ? value.slice(COMMAND_PREFIX.length) : value;

  const rows = useMemo<Row[]>(() => {
    if (custom) {
      return fuzzyFilter(custom.items, query, (i) => i.label).map(({ item, match }) => ({
        key: item.id,
        label: item.label,
        indices: match.indices,
        ...(item.description === undefined ? {} : { description: item.description }),
        ...(item.current ? { badge: t('quick.current') } : {}),
        run: item.run,
      }));
    }
    if (commandMode) {
      const recent = readRecent().filter((id) => available.has(id));
      const all = COMMANDS.filter((c) => available.has(c.id)).map((c) => ({
        id: c.id,
        label: `${t(c.category)}: ${t(c.title)}`,
      }));
      const ordered =
        query.trim() === ''
          ? [
              ...recent.flatMap((id) => all.filter((c) => c.id === id)),
              ...all
                .filter((c) => !recent.includes(c.id))
                .sort((a, b) => a.label.localeCompare(b.label)),
            ]
          : all;
      return fuzzyFilter(ordered, query, (c) => c.label).map(({ item, match }) => {
        const binding = bindings.get(item.id)?.[0];
        return {
          key: item.id,
          label: item.label,
          indices: match.indices,
          ...(binding === undefined ? {} : { binding }),
          ...(query.trim() === '' && recent.includes(item.id) ? { badge: t('quick.recent') } : {}),
          run: () => {
            rememberRecent(item.id);
            runCommand(item.id);
          },
        };
      });
    }
    const nodes = [...(graph.data?.nodes ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    return fuzzyFilter(nodes, query, (n) => n.title).map(({ item, match }) => ({
      key: item.id,
      label: item.title,
      indices: match.indices,
      description: item.type,
      run: () => void navigate(`/nodes/${item.id}`),
    }));
  }, [custom, commandMode, query, available, bindings, graph.data, navigate, t]);

  const shown = rows.slice(0, MAX_ROWS);
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = () => {
    closeQuickInput();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  };

  const accept = (row: Row | undefined) => {
    if (!row) return;
    close(); // first, so commands that move focus win over the restore
    row.run();
  };

  const move = (delta: number) => {
    if (shown.length === 0) return;
    setActive((activeIndex + delta + shown.length) % shown.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        move(1);
      },
      ArrowUp: () => {
        move(-1);
      },
      PageDown: () => {
        setActive(Math.min(activeIndex + 10, shown.length - 1));
      },
      PageUp: () => {
        setActive(Math.max(activeIndex - 10, 0));
      },
      Enter: () => {
        accept(shown[activeIndex]);
      },
      Escape: close,
      Tab: () => undefined, // stay in the box
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  const placeholder = custom
    ? custom.placeholder
    : commandMode
      ? t('quick.commandsPlaceholder')
      : t('quick.nodesPlaceholder');
  const empty = custom
    ? t('quick.noResults')
    : commandMode
      ? t('quick.noCommands')
      : t('quick.noNodes');
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div
      className="quick-input-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="quick-input" role="dialog" aria-label={t('quick.label')}>
        <input
          autoFocus
          role="combobox"
          aria-label={placeholder}
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown.length ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={value}
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="quick-input-list" role="listbox" id={listId} ref={listRef}>
          {shown.map((row, i) => (
            <li
              key={row.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
              }}
              onClick={() => {
                accept(row);
              }}
            >
              <span className="quick-input-label">
                <Highlighted text={row.label} indices={row.indices} />
              </span>
              {row.description && <span className="quick-input-desc">{row.description}</span>}
              {row.badge && <span className="quick-input-badge">{row.badge}</span>}
              {row.binding && <Keys binding={row.binding} />}
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="quick-input-empty" role="status">
            {empty}
          </p>
        )}
      </div>
    </div>
  );
}
