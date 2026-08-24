'use client';

/* ---------------------------------------------------------------------------
 * CommandPalette — ⌘K, the whole portal on one keystroke.
 *
 * Four sections: go somewhere, do something, jump to a goal, move your data.
 *
 * Two behaviours are worth calling out.
 *
 * 1. CAPTURE WITHOUT LEAVING. "Add task to today" and "Capture to inbox" do
 *    not close the palette and drop you somewhere else — they turn the palette
 *    itself into a single-field composer. Enter files the item and clears the
 *    field so you can keep going; Escape steps back to the list rather than
 *    dismissing (handled through Radix's `onEscapeKeyDown`, the only reliable
 *    hook once the dialog owns the key).
 *
 * 2. HANDOFF TO A VIEW. Starting a review or opening a goal is a message to a
 *    surface that has not mounted yet — the workspace cross-fades views over
 *    ~250ms. So the CustomEvent is dispatched after that switch has settled;
 *    dispatching synchronously would shout into an empty room.
 *
 * Radix portals the dialog to <body>, outside `.assistant-shell`, and every
 * `.pa-*` class is scoped under it — hence the shell wrapper inside the
 * content. `pa-portal` strips the host kit's fill, border, shadow and
 * `rounded-lg` off the portal container — that second, squarer rectangle was
 * the doubled corner — and the `.pa-sheet` inside owns every pixel, clipping
 * the input bar, the list and the hint rail to its own radius.
 *
 * The dialog is centred with a transform, so nothing in here may use
 * backdrop-filter (`.pa-cta`, `.pa-frost`); `.pa-sheet` is a near-opaque fill
 * that needs none.
 * ------------------------------------------------------------------------- */

import { clsx } from 'clsx';
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CalendarRange,
  ClipboardCopy,
  CornerDownLeft,
  Download,
  Dumbbell,
  FileText,
  Inbox,
  Moon,
  MoonStar,
  NotebookPen,
  Plus,
  Repeat,
  Redo2,
  RotateCcw,
  Sparkles,
  Sun,
  SunMedium,
  Target,
  Undo2,
  Upload,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@web/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@web/components/ui/dialog';
import { GLASS_BOX, GlassButton } from '@/components/ui/glass-button';

import { capitaliseOnType } from '../../lib/capitalise';
import { buildBrief } from '../../lib/brief';
import { activeGoals } from '../../lib/derive';
import { useAssistant } from '../../lib/store';
import { useAssistantTheme } from '../../lib/theme';
import { VIEW_IDS, type Goal, type LifeArea, type ViewId } from '../../lib/types';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: ViewId) => void;
}

/* -------------------------------------------------------------------------
 * Contract with the views
 * ---------------------------------------------------------------------- */

/** The review view opens its daily shutdown composer on this. */
export const START_DAILY_REVIEW_EVENT = 'assistant:start-daily-review';
/** The review view opens its weekly retrospective composer on this. */
export const START_WEEKLY_REVIEW_EVENT = 'assistant:start-weekly-review';
/** The goals view expands the goal in `detail.goalId` on this. */
export const OPEN_GOAL_EVENT = 'assistant:open-goal';

/** Long enough for the workspace's 250ms view cross-fade to have mounted. */
const VIEW_SWITCH_MS = 380;

/**
 * Hands a string to the browser as a downloaded file.
 *
 * The anchor has to be in the document before it is clicked — a detached one is
 * a no-op in Firefox — and the object URL has to outlive the click, hence the
 * revoke on a timer rather than on the next line.
 */
function saveFile(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Goals offered in the jump list — beyond this it stops being a shortcut. */
const MAX_GOALS = 8;

/* -------------------------------------------------------------------------
 * Static tables
 * ---------------------------------------------------------------------- */

interface ViewMeta {
  id: ViewId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** Kept in VIEW_IDS order so the 1–9 hints line up with the real hotkeys. */
const VIEW_META: ViewMeta[] = [
  { id: 'today', label: 'Today', hint: 'The Big Three and the day’s list', icon: Sun },
  { id: 'week', label: 'Week', hint: 'Plan seven days at once', icon: CalendarRange },
  { id: 'review', label: 'Review', hint: 'Shutdown and retrospective', icon: NotebookPen },
  { id: 'inbox', label: 'Inbox', hint: 'Triage what you captured', icon: Inbox },
  { id: 'habits', label: 'Habits', hint: 'Streaks and consistency', icon: Repeat },
  { id: 'workouts', label: 'Train', hint: 'The week’s sessions and loads', icon: Dumbbell },
  { id: 'food', label: 'Food', hint: 'What you ate, and what is left', icon: UtensilsCrossed },
  { id: 'goals', label: 'Goals', hint: 'Vision, year and quarter', icon: Target },
  { id: 'insights', label: 'Insights', hint: 'Momentum and trends', icon: BarChart3 },
];

type Mode = 'root' | 'task' | 'inbox';

interface ComposerMeta {
  title: string;
  placeholder: string;
  icon: LucideIcon;
  submitLabel: string;
}

const COMPOSER: Record<'task' | 'inbox', ComposerMeta> = {
  task: {
    title: 'New task for today',
    placeholder: 'What needs doing today?',
    icon: Plus,
    submitLabel: 'Add task to today',
  },
  inbox: {
    title: 'Capture to inbox',
    placeholder: 'Anything on your mind…',
    icon: Inbox,
    submitLabel: 'Capture to inbox',
  },
};

/* -------------------------------------------------------------------------
 * Shared class strings
 * ---------------------------------------------------------------------- */

/** Neutralises `.assistant-shell`'s page geometry inside a portal. */
const PORTAL_SHELL = { minHeight: 0, overflowX: 'visible' } as const;

/* The portal container is a bare positioning box once `pa-portal` has stripped
 * the host's frosting; this is the only surface, and it carries the whole look
 * — `--pa-solid` body, `--pa-edge` lip, `--pa-shadow-xl` lift — on both themes. */
/* `max-h` + a column so the LIST is what shrinks when the keyboard takes
 * half the screen, rather than the input scrolling out of reach. */
const SURFACE = 'pa-sheet flex max-h-[86dvh] flex-col overflow-hidden';

/* The scrim renders outside `.assistant-shell`, where the `--pa-*` tokens do not
 * resolve, so it is the same deep navy black the shutdown wizard uses: a modal
 * dim on the light stage, a deepening on the dark one. */
const OVERLAY = 'bg-[rgba(8,20,44,0.44)] backdrop-blur-[3px]';

const CMD_ROOT = clsx(
  'bg-transparent text-[color:var(--pa-navy)]',
  '[&_[data-slot=command-input-wrapper]]:h-[54px]',
  '[&_[data-slot=command-input-wrapper]]:gap-2.5',
  '[&_[data-slot=command-input-wrapper]]:px-4',
  '[&_[data-slot=command-input-wrapper]]:border-[color:var(--pa-line)]',
);

const CMD_GROUP = clsx(
  'p-1.5',
  '[&_[cmdk-group-heading]]:px-2.5',
  '[&_[cmdk-group-heading]]:pb-1',
  '[&_[cmdk-group-heading]]:pt-2',
  '[&_[cmdk-group-heading]]:text-[10px]',
  '[&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:uppercase',
  '[&_[cmdk-group-heading]]:tracking-[0.12em]',
  '[&_[cmdk-group-heading]]:text-[color:var(--pa-faint)]',
);

/* The highlight is a token wash plus a hairline ring: on white the wash carries
 * it alone, but on the dark sheet the ring is what gives the selected row an
 * edge to sit against. */
const CMD_ITEM = clsx(
  'group flex cursor-pointer items-center gap-3 rounded-[0.85rem] px-2.5 py-2.5 text-[13.5px]',
  'data-[selected=true]:bg-[color:var(--pa-accent-bg)]',
  'data-[selected=true]:text-[color:var(--pa-navy)]',
  'data-[selected=true]:shadow-[inset_0_0_0_1px_var(--pa-accent-ring)]',
);

/* A key cap: a lifted wash rather than white, so it reads as raised on the pale
 * sheet and as a lit key on the dark one. */
const KBD =
  'rounded-[0.4rem] border border-[color:var(--pa-line)] bg-[color:var(--pa-hover-wash)] ' +
  'px-1.5 py-px font-sans text-[10.5px] font-medium leading-[1.5] text-[color:var(--pa-faint)]';

/* The glass pill carries no focus style of its own and its look is five stacked
 * box-shadows, so the keyboard ring has to be an OUTLINE — it follows the pill's
 * radius without touching any of them. */
const GLASS_FOCUS = clsx(
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[color:var(--pa-azure)]',
);

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/* -------------------------------------------------------------------------
 * One row of the palette
 * ---------------------------------------------------------------------- */

interface PaletteItemProps {
  /** Everything cmdk should match a query against. */
  value: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  shortcut?: string;
  /** Overrides the azure chip — used for the destructive-adjacent data rows. */
  dot?: string;
  onSelect: () => void;
}

/** Area accents are stored as 6-digit hex, so alpha can be appended safely. */
const HEX = /^#[0-9a-f]{6}$/i;

function PaletteItem({
  value,
  label,
  icon: Icon,
  hint,
  shortcut,
  dot,
  onSelect,
}: PaletteItemProps): JSX.Element {
  const chipStyle =
    dot !== undefined && HEX.test(dot)
      ? { background: `${dot}1f`, color: dot, boxShadow: `inset 0 0 0 1px ${dot}33` }
      : undefined;

  return (
    <CommandItem value={value} onSelect={onSelect} className={CMD_ITEM}>
      <span className="pa-chip size-7 shrink-0 rounded-[0.6rem]" style={chipStyle} aria-hidden="true">
        <Icon className="size-3.5 text-current" strokeWidth={1.9} />
      </span>

      <span className="min-w-0 flex-1 truncate text-[color:var(--pa-navy)]">{label}</span>

      {hint ? (
        <span className="hidden max-w-[46%] shrink-0 truncate text-[11.5px] text-[color:var(--pa-faint)] sm:block">
          {hint}
        </span>
      ) : null}

      {shortcut ? (
        <kbd className={clsx(KBD, 'shrink-0')} aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}

      <CornerDownLeft
        className="size-3.5 shrink-0 text-[color:var(--pa-azure)] opacity-0 transition-opacity duration-150 group-data-[selected=true]:opacity-100"
        strokeWidth={2}
        aria-hidden="true"
      />
    </CommandItem>
  );
}

/* -------------------------------------------------------------------------
 * The palette
 * ---------------------------------------------------------------------- */

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: CommandPaletteProps): JSX.Element {
  /* `today` comes from the provider rather than `todayKey()`, so a palette left
   * open across midnight files the next task on the right day. */
  const { data, actions, today } = useAssistant();
  const { theme, toggle: toggleTheme } = useAssistantTheme();
  const reduce = useReducedMotion();

  const [mode, setMode] = useState<Mode>('root');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');

  const composerRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);

  /* Never let a scheduled handoff fire into an unmounted tree. */
  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    },
    [],
  );

  /** Fires `fn` once the workspace's view cross-fade has settled. */
  const afterViewSwitch = useCallback((fn: () => void): void => {
    const id = window.setTimeout(fn, VIEW_SWITCH_MS);
    timersRef.current.push(id);
  }, []);

  /* ---- reset every time the palette is put away ----
   * After the dismiss animation, not during it: resetting synchronously would
   * flip a composer back to the command list in full view of the user. */
  useEffect(() => {
    if (open) return undefined;
    const id = window.setTimeout(() => {
      setMode('root');
      setQuery('');
      setDraft('');
    }, 220);
    return () => window.clearTimeout(id);
  }, [open]);

  /* Focus follows the mode through `autoFocus` on each panel's field: the two
   * panels swap with `mode="wait"`, so the incoming input mounts a beat after
   * the mode changes and an effect would fire against a ref that is still null. */

  const close = useCallback((): void => onOpenChange(false), [onOpenChange]);

  /* ---- navigation ---- */
  const goTo = useCallback(
    (view: ViewId): void => {
      close();
      onNavigate(view);
    },
    [close, onNavigate],
  );

  /* ---- quick actions ---- */
  const startReview = useCallback(
    (type: 'daily' | 'weekly'): void => {
      goTo('review');
      afterViewSwitch(() => {
        window.dispatchEvent(
          new CustomEvent(type === 'daily' ? START_DAILY_REVIEW_EVENT : START_WEEKLY_REVIEW_EVENT),
        );
      });
    },
    [afterViewSwitch, goTo],
  );

  const openGoal = useCallback(
    (goalId: string): void => {
      goTo('goals');
      afterViewSwitch(() => {
        window.dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: { goalId } }));
      });
    },
    [afterViewSwitch, goTo],
  );

  /* Undo lives in three places, and a phone can reach none of them: the header
   * buttons scroll away, the brief card is `display: none` below 1440px, and
   * ⌘Z needs a keyboard. Every mis-tapped checkbox was permanent. The palette
   * is always one tap from the header. */
  const undo = useCallback((): void => {
    close();
    if (actions.undo()) toast.success('Change undone');
    else toast.message('Nothing left to undo');
  }, [actions, close]);

  const redo = useCallback((): void => {
    close();
    if (actions.redo()) toast.success('Change redone');
    else toast.message('Nothing to redo');
  }, [actions, close]);

  const carryOver = useCallback((): void => {
    close();
    const moved = actions.carryOverTo(today);
    if (moved === 0) {
      toast.success('Nothing left behind', { description: 'No unfinished tasks before today.' });
      return;
    }
    toast.success(`${moved} ${moved === 1 ? 'task' : 'tasks'} rolled onto today`, {
      description: 'Anything you keep carrying is probably too big.',
    });
  }, [actions, close, today]);

  /* ---- appearance ----
   * Deliberately does NOT close: the whole surface repaints under the cursor,
   * which is the clearest possible confirmation that the switch landed. */
  const switchTheme = useCallback((): void => {
    toggleTheme();
  }, [toggleTheme]);

  /* ---- data ---- */
  const exportJson = useCallback((): void => {
    close();
    try {
      const filename = `assistant-backup-${today}.json`;
      saveFile(filename, actions.exportJson(), 'application/json');
      toast.success('Backup downloaded', { description: filename });
    } catch (error) {
      toast.error('Could not export your data', {
        description: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }, [actions, close, today]);

  /* ---- the brief ----
   * Two ways out of the same text, because there are two sizes of it. A few
   * months of use is small enough to paste straight into a chat and is quicker
   * that way; a few years is not, and a file gets attached instead. Neither is
   * a setting to choose in advance — the character count in the toast is what
   * tells you which one you have. */
  const copyBrief = useCallback(async (): Promise<void> => {
    close();
    try {
      const { markdown, meta } = buildBrief(data, today);
      const size = `${Math.round(meta.characters / 1000)}k characters, roughly ${Math.round(meta.approxTokens / 1000)}k tokens`;
      try {
        await navigator.clipboard.writeText(markdown);
        toast.success('Brief copied — paste it into a chat', { description: size });
      } catch {
        /* No clipboard: an insecure origin, a browser that wants a user
           gesture it no longer believes it has, or a denied permission. The
           text still exists, so hand it over the other way rather than
           reporting a failure the person can do nothing about. */
        const filename = `assistant-brief-${today}.md`;
        saveFile(filename, markdown, 'text/markdown');
        toast.success('Brief downloaded instead', {
          description: `This browser would not let the page write to the clipboard. ${size}.`,
        });
      }
    } catch (error) {
      toast.error('Could not build the brief', {
        description: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }, [close, data, today]);

  const downloadBrief = useCallback((): void => {
    close();
    try {
      const { markdown, meta } = buildBrief(data, today);
      const filename = `assistant-brief-${today}.md`;
      saveFile(filename, markdown, 'text/markdown');
      toast.success('Brief downloaded', {
        description: `${filename} — ${Math.round(meta.characters / 1000)}k characters, roughly ${Math.round(meta.approxTokens / 1000)}k tokens.`,
      });
    } catch (error) {
      toast.error('Could not build the brief', {
        description: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }, [close, data, today]);

  const pickImportFile = useCallback((): void => {
    close();
    /* The input lives outside the dialog, so it survives this close. */
    fileRef.current?.click();
  }, [close]);

  const onFileChosen = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      // Cleared straight away so re-picking the same file still fires a change.
      event.target.value = '';
      if (!file) return;
      try {
        actions.importJson(await file.text());
        toast.success('Backup restored', { description: file.name });
      } catch (error) {
        toast.error('That file could not be imported', {
          description: error instanceof Error ? error.message : 'Unknown error.',
        });
      }
    },
    [actions],
  );

  const loadExample = useCallback((): void => {
    close();
    actions.loadSeed();
    toast.success('Example plan loaded', {
      description: 'Four months of goals, streaks and reviews to explore.',
    });
  }, [actions, close]);

  /* ---- the two-step composer ---- */
  const submitComposer = useCallback((): void => {
    const text = draft.trim();
    if (text.length === 0) return;

    if (mode === 'task') {
      actions.addTask({ title: text, scheduledFor: today });
      toast.success('Added to today', { description: text });
    } else if (mode === 'inbox') {
      actions.addInbox(text);
      toast.success('Captured to your inbox', { description: text });
    }

    setDraft('');
    composerRef.current?.focus();
  }, [actions, draft, mode, today]);

  const onComposerKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitComposer();
    }
  };

  /* ---- jump-to-goal list ---- */
  const goals = useMemo(() => {
    const areas = new Map<string, LifeArea>(
      data.areas.map((area): [string, LifeArea] => [area.id, area]),
    );
    return activeGoals(data)
      .slice(0, MAX_GOALS)
      .map((goal: Goal) => ({
        goal,
        area: goal.areaId === null ? null : areas.get(goal.areaId) ?? null,
      }));
  }, [data]);

  const composer = mode === 'root' ? null : COMPOSER[mode];
  const ComposerIcon = composer?.icon ?? Plus;
  const empty = draft.trim().length === 0;

  const dark = theme === 'dark';

  const panelMotion = {
    initial: { opacity: 0, y: reduce ? 0 : 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : -4 },
    transition: { duration: 0.18, ease: HOUSE_EASE },
  };

  return (
    <>
      {/* Outside the dialog on purpose: the picker opens after the palette closes. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void onFileChosen(event);
        }}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          overlayClassName={OVERLAY}
          onEscapeKeyDown={(event) => {
            // In composer mode Escape means "back to the list", not "dismiss".
            if (mode === 'root') return;
            event.preventDefault();
            setMode('root');
          }}
          className={clsx(
            'pa-portal',
            'top-[7dvh] block translate-y-0 gap-0 border-0 bg-transparent p-0 shadow-none',
            'sm:top-[12dvh] sm:max-w-[640px]',
          )}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Search the portal, run a quick action, jump to a goal or move your data.
          </DialogDescription>

          <div className="assistant-shell" style={PORTAL_SHELL}>
            <div className={SURFACE}>
              <AnimatePresence mode="wait" initial={false}>
                {composer ? (
                  /* ---------------- composer mode ---------------- */
                  <motion.div key={mode} {...panelMotion}>
                    <div className="flex h-[54px] items-center gap-2.5 border-b border-[color:var(--pa-line)] px-3 sm:px-4">
                      <button
                        type="button"
                        onClick={() => setMode('root')}
                        className="pa-icon-btn pa-focus size-8 shrink-0"
                        aria-label="Back to commands"
                        data-tip="Back"
                        data-tip-key="Esc"
                      >
                        <ArrowLeft className="size-4" strokeWidth={1.9} aria-hidden="true" />
                      </button>

                      <span className="pa-chip size-7 shrink-0 rounded-[0.6rem]" aria-hidden="true">
                        <ComposerIcon className="size-3.5" strokeWidth={1.9} />
                      </span>

                      <input
                        ref={composerRef}
                        // eslint-disable-next-line jsx-a11y/no-autofocus -- focus inside an open dialog
                        autoFocus
                        type="text"
                        value={draft}
                        onChange={(event) => setDraft(capitaliseOnType(event))}
                        onKeyDown={onComposerKeyDown}
                        placeholder={composer.placeholder}
                        aria-label={composer.title}
                        autoComplete="off"
                        spellCheck={false}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[color:var(--pa-navy)] outline-none placeholder:text-[color:var(--pa-faint)]"
                      />

                      {/* The one primary action on this surface, so it is the
                          haze-light glass pill. Empty means nothing to file:
                          the button is genuinely `disabled` for the keyboard,
                          and the wrapper dims — the glass has no disabled state
                          of its own, and the utility would lose the cascade to
                          theme-v2's `.glass-button`. */}
                      <GlassButton
                        className={clsx(
                          'glass-button--haze-light shrink-0',
                          empty && 'cursor-default opacity-40',
                        )}
                        size="none"
                        type="button"
                        buttonClassName={clsx(GLASS_BOX.icon8.button, GLASS_FOCUS)}
                        contentClassName={GLASS_BOX.icon8.content}
                        onClick={submitComposer}
                        disabled={empty}
                        aria-label={composer.submitLabel}
                      >
                        {/* theme-v2 pins the label span to `display: block` with
                            more specificity than a utility can reach, so the
                            centring happens one level in. */}
                        <span className="flex size-full items-center justify-center">
                          <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                        </span>
                      </GlassButton>
                    </div>

                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3.5 text-[11.5px] text-[color:var(--pa-faint)]">
                      <span className="text-[color:var(--pa-muted)]">{composer.title}.</span>
                      <span className="inline-flex items-center gap-1.5">
                        <kbd className={KBD}>↵</kbd> file it and keep going
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <kbd className={KBD}>esc</kbd> back
                      </span>
                    </p>
                  </motion.div>
                ) : (
                  /* ---------------- command mode ---------------- */
                  <motion.div key="root" {...panelMotion}>
                    <Command className={CMD_ROOT} loop>
                      <CommandInput
                        autoFocus
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search views, actions and goals…"
                        className="h-[54px] text-[14px] placeholder:text-[color:var(--pa-faint)]"
                      />

                      <CommandList className="max-h-[min(58dvh,440px)] px-1 pb-1">
                        <CommandEmpty className="px-4 py-12 text-center text-[13px] text-[color:var(--pa-muted)]">
                          Nothing matches that.
                        </CommandEmpty>

                        <CommandGroup heading="Navigation" className={CMD_GROUP}>
                          {VIEW_META.map((view) => (
                            <PaletteItem
                              key={view.id}
                              value={`Go to ${view.label} ${view.hint}`}
                              label={view.label}
                              hint={view.hint}
                              icon={view.icon}
                              shortcut={String(VIEW_IDS.indexOf(view.id) + 1)}
                              onSelect={() => goTo(view.id)}
                            />
                          ))}
                        </CommandGroup>

                        <CommandGroup heading="Quick actions" className={CMD_GROUP}>
                          <PaletteItem
                            value="Add task to today new task"
                            label="Add task to today"
                            hint="Type it here"
                            icon={Plus}
                            onSelect={() => {
                              setDraft('');
                              setMode('task');
                            }}
                          />
                          <PaletteItem
                            value="Capture to inbox note thought idea"
                            label="Capture to inbox"
                            hint="Sort it out later"
                            icon={Inbox}
                            onSelect={() => {
                              setDraft('');
                              setMode('inbox');
                            }}
                          />
                          <PaletteItem
                            value="Start daily shutdown evening review"
                            label="Start daily shutdown"
                            hint="Close the day properly"
                            icon={MoonStar}
                            onSelect={() => startReview('daily')}
                          />
                          <PaletteItem
                            value="Start weekly review retrospective"
                            label="Start weekly review"
                            hint="Five minutes, one focus"
                            icon={NotebookPen}
                            onSelect={() => startReview('weekly')}
                          />
                          <PaletteItem
                            value="Carry over unfinished tasks roll forward"
                            label="Carry over unfinished"
                            hint="Roll everything overdue onto today"
                            icon={RotateCcw}
                            onSelect={carryOver}
                          />
                          <PaletteItem
                            value="Undo revert take back last change mistake"
                            label="Undo the last change"
                            hint="Also ⌘Z"
                            icon={Undo2}
                            onSelect={undo}
                          />
                          <PaletteItem
                            value="Redo repeat forward again"
                            label="Redo"
                            hint="Also ⇧⌘Z"
                            icon={Redo2}
                            onSelect={redo}
                          />
                          <PaletteItem
                            value="Switch theme appearance dark light mode"
                            label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                            hint={dark ? 'Currently dark' : 'Currently light'}
                            icon={dark ? SunMedium : Moon}
                            onSelect={switchTheme}
                          />
                        </CommandGroup>

                        {goals.length > 0 ? (
                          <CommandGroup heading="Jump to goal" className={CMD_GROUP}>
                            {goals.map(({ goal, area }) => (
                              <PaletteItem
                                key={goal.id}
                                value={`Goal ${goal.title} ${area?.name ?? ''} ${goal.id}`}
                                label={goal.title}
                                hint={area ? area.name : 'Unfiled'}
                                icon={Target}
                                dot={area?.color}
                                onSelect={() => openGoal(goal.id)}
                              />
                            ))}
                          </CommandGroup>
                        ) : null}

                        <CommandGroup heading="Data" className={CMD_GROUP}>
                          {/* First in the group on purpose. It is the one thing
                              here somebody comes looking for without already
                              knowing it exists — the other three are chores. */}
                          <PaletteItem
                            value="Copy brief for an LLM ChatGPT Claude analysis analyse everything markdown summary export"
                            label="Copy a brief for an LLM"
                            hint="Everything, written out to paste into a chat"
                            icon={ClipboardCopy}
                            onSelect={() => void copyBrief()}
                          />
                          <PaletteItem
                            value="Download brief markdown LLM analysis file md"
                            label="Download that brief as Markdown"
                            hint={`assistant-brief-${today}.md`}
                            icon={FileText}
                            onSelect={downloadBrief}
                          />
                          <PaletteItem
                            value="Export JSON backup download data"
                            label="Export JSON"
                            hint={`assistant-backup-${today}.json`}
                            icon={Download}
                            onSelect={exportJson}
                          />
                          <PaletteItem
                            value="Import JSON restore backup upload data"
                            label="Import JSON"
                            hint="Replaces everything in this browser"
                            icon={Upload}
                            onSelect={pickImportFile}
                          />
                          <PaletteItem
                            value="Load example data demo seed sample plan"
                            label="Load example data"
                            hint="A worked four-month plan"
                            icon={Sparkles}
                            onSelect={loadExample}
                          />
                        </CommandGroup>
                      </CommandList>

                      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--pa-line)] px-4 py-2.5">
                        <span className="flex items-center gap-3 text-[11px] text-[color:var(--pa-faint)]">
                          <span className="inline-flex items-center gap-1.5">
                            <kbd className={KBD}>↑</kbd>
                            <kbd className={KBD}>↓</kbd> navigate
                          </span>
                          <span className="hidden items-center gap-1.5 sm:inline-flex">
                            <kbd className={KBD}>↵</kbd> select
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--pa-faint)]">
                          <kbd className={KBD}>esc</kbd> close
                        </span>
                      </div>
                    </Command>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
