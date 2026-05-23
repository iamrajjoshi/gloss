import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  FileJson2,
  GitBranch,
  MessageSquare,
  Play,
  Terminal,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const installCommand = 'brew install iamrajjoshi/tap/gloss';
const npmInstallCommand = 'npm install -g getgloss';
const runCommand = 'gloss open --base HEAD --json';
const npxCommand = 'npx getgloss open --base HEAD --json';
const skillInstallCommand =
  'mkdir -p ~/.claude/skills/gloss && curl -fsSL https://getgloss.dev/skill/SKILL.md -o ~/.claude/skills/gloss/SKILL.md';
const agentPrompt = 'Install Gloss with Homebrew or npm. Then read https://getgloss.dev/setup.md.';
const marketingSectionIds = ['install', 'skill', 'workflow', 'contract'] as const;

type MarketingSectionId = (typeof marketingSectionIds)[number];
type DemoSide = 'L' | 'R';

interface DemoSelection {
  side: DemoSide;
  startLine: number;
  endLine: number;
}

interface DemoComment extends DemoSelection {
  id: string;
  body: string;
  createdAt: string;
}

interface DemoCodeRow {
  code: string;
  hiddenUntilExpanded?: boolean;
  key: string;
  newLine?: number;
  oldLine?: number;
  side: DemoSide;
  tone: 'neutral' | 'add' | 'remove';
}

const initialDemoSelection: DemoSelection = {
  side: 'R',
  startLine: 45,
  endLine: 45
};

const seededDemoComments: DemoComment[] = [
  {
    id: 'seed-human-review',
    side: 'R',
    startLine: 45,
    endLine: 45,
    body: 'Apply the review feedback before resolving the thread so the agent cannot skip the human pass.',
    createdAt: '2026-05-23T00:00:00.000Z'
  }
];

const demoCodeRows: DemoCodeRow[] = [
  {
    key: 'open-review',
    oldLine: 38,
    newLine: 38,
    side: 'R',
    tone: 'neutral',
    code: "const review = await gloss.open({ base: 'HEAD' });"
  },
  {
    key: 'add-reviewer',
    oldLine: 39,
    newLine: 39,
    side: 'R',
    tone: 'neutral',
    hiddenUntilExpanded: true,
    code: "review.addReviewer('human');"
  },
  {
    key: 'blocking-mode',
    oldLine: 40,
    newLine: 40,
    side: 'R',
    tone: 'neutral',
    hiddenUntilExpanded: true,
    code: "review.setMode('blocking');"
  },
  {
    key: 'wait-feedback',
    oldLine: 41,
    newLine: 41,
    side: 'R',
    tone: 'neutral',
    hiddenUntilExpanded: true,
    code: 'const feedback = await review.waitForFeedback();'
  },
  {
    key: 'filter-comments',
    oldLine: 42,
    newLine: 42,
    side: 'R',
    tone: 'neutral',
    code: 'const comments = feedback.comments.filter((comment) => comment.actionable);'
  },
  {
    key: 'skip-review',
    oldLine: 43,
    side: 'L',
    tone: 'remove',
    code: 'agent.resumeWithoutReview();'
  },
  {
    key: 'skip-status',
    oldLine: 44,
    side: 'L',
    tone: 'remove',
    code: "agent.postStatus('review skipped');"
  },
  {
    key: 'guard-comments',
    newLine: 45,
    side: 'R',
    tone: 'add',
    code: 'if (comments.length > 0) {'
  },
  {
    key: 'apply-feedback',
    newLine: 46,
    side: 'R',
    tone: 'add',
    code: '  await agent.applyFeedback(comments);'
  },
  {
    key: 'resolve-threads',
    newLine: 47,
    side: 'R',
    tone: 'add',
    code: '  await review.resolveThreads(comments);'
  },
  {
    key: 'run-checks',
    newLine: 48,
    side: 'R',
    tone: 'add',
    code: "  await agent.runChecks(['pnpm check', 'pnpm test']);"
  },
  {
    key: 'close-guard',
    newLine: 49,
    side: 'R',
    tone: 'add',
    code: '}'
  },
  {
    key: 'write-markdown',
    newLine: 50,
    side: 'R',
    tone: 'add',
    code: 'await review.writeFeedbackMarkdown();'
  },
  {
    key: 'attach-validation',
    newLine: 51,
    side: 'R',
    tone: 'add',
    code: "await review.attachValidation('pnpm test');"
  },
  {
    key: 'resume-reviewed',
    newLine: 52,
    side: 'R',
    tone: 'add',
    code: 'await agent.resume({ reviewed: true });'
  },
  {
    key: 'summary',
    oldLine: 45,
    newLine: 53,
    side: 'R',
    tone: 'neutral',
    code: 'return review.summary();'
  }
];

function isMarketingSectionId(id: string): id is MarketingSectionId {
  return marketingSectionIds.some((sectionId) => sectionId === id);
}

function labelForSelection(selection: DemoSelection): string {
  if (selection.startLine === selection.endLine) {
    return `Comment on line ${selection.side}${selection.startLine}`;
  }

  return `Comment on range ${selection.side}${Math.min(selection.startLine, selection.endLine)}-${selection.side}${Math.max(selection.startLine, selection.endLine)}`;
}

function createDemoComment(body: string, selection: DemoSelection): DemoComment {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    ...selection,
    id,
    body,
    createdAt: new Date().toISOString()
  };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="marketing-copy"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={15} /> : <Clipboard size={15} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

function CommandLine({ command }: { command: string }) {
  return (
    <div className="command-line">
      <span>$</span>
      <code>{command}</code>
      <CopyButton value={command} label="Copy" />
    </div>
  );
}

function HeroDiffScene() {
  const [expanded, setExpanded] = useState(true);
  const [selectedLine, setSelectedLine] = useState<DemoSelection>(initialDemoSelection);
  const [composerOpen, setComposerOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [comments, setComments] = useState<DemoComment[]>(seededDemoComments);
  const [submitState, setSubmitState] = useState<'idle' | 'submitted'>('idle');
  const activeComment = comments.find((comment) => comment.id === activeCommentId);
  const selectedLabel = labelForSelection(selectedLine);
  const trimmedDraft = draft.trim();
  const visibleDemoRows = expanded
    ? demoCodeRows
    : demoCodeRows.filter((row) => !row.hiddenUntilExpanded);
  const feedbackPreview = useMemo(
    () =>
      JSON.stringify(
        {
          reviewId: '01KS5...',
          comments: comments.map((comment) => ({
            filePath: 'src/web/routes/MarketingHome.tsx',
            side: comment.side,
            startLine: comment.startLine,
            endLine: comment.endLine,
            body: comment.body
          }))
        },
        null,
        2
      ),
    [comments]
  );

  const isSelectedLine = (side: DemoSide, line: number) =>
    selectedLine.side === side && selectedLine.startLine === line && selectedLine.endLine === line;

  const selectLine = (selection: DemoSelection) => {
    setSelectedLine(selection);
    setActiveCommentId(null);
    setDraft('');
    setComposerOpen(true);
  };

  const openComment = (comment: DemoComment) => {
    setSelectedLine({
      side: comment.side,
      startLine: comment.startLine,
      endLine: comment.endLine
    });
    setActiveCommentId(comment.id);
    setDraft(comment.body);
    setComposerOpen(true);
  };

  const saveComment = () => {
    if (!trimmedDraft) {
      return;
    }

    setComments((current) =>
      activeCommentId
        ? current.map((comment) =>
            comment.id === activeCommentId ? { ...comment, body: trimmedDraft } : comment
          )
        : [...current, createDemoComment(trimmedDraft, selectedLine)]
    );
    setDraft('');
    setActiveCommentId(null);
    setComposerOpen(false);
    setSubmitState('idle');
  };

  const removeComment = (id: string) => {
    setComments((current) => current.filter((comment) => comment.id !== id));
    if (activeCommentId === id) {
      setActiveCommentId(null);
      setDraft('');
      setComposerOpen(false);
    }
    setSubmitState('idle');
  };

  const commentsForLine = (side: DemoSide, line: number) =>
    comments.filter(
      (comment) =>
        comment.side === side &&
        Math.max(comment.startLine, comment.endLine) === line &&
        Math.min(comment.startLine, comment.endLine) === line
    );

  const renderLineComments = (side: DemoSide, line: number) =>
    commentsForLine(side, line).map((comment) => (
      <div className="scene-inline-comment" key={comment.id}>
        <button
          className="scene-inline-comment-body"
          type="button"
          onClick={() => openComment(comment)}
        >
          <MessageSquare size={14} />
          <span>{comment.body}</span>
        </button>
        <button
          className="scene-inline-comment-remove"
          type="button"
          title={`Remove comment on ${comment.side}${comment.startLine}`}
          onClick={() => removeComment(comment.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    ));

  return (
    <section className="hero-scene" aria-label="Simulated Gloss code review">
      <div className="scene-topbar">
        <div className="scene-brand">
          <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
          <span>Gloss review</span>
        </div>
        <div className="scene-meta">
          <GitBranch size={14} />
          <span>raj--gloss--static-site</span>
        </div>
      </div>

      <div className="scene-shell">
        <div className="scene-terminal">
          <div className="terminal-header">
            <Terminal size={14} />
            <span>agent terminal</span>
          </div>
          <div className="terminal-lines">
            <p>
              <span>$</span> gloss open --base HEAD --json
            </p>
            <p>
              <span>→</span> captured 4 files, +128 -31
            </p>
            <p>
              <span>→</span> waiting for review.completed
            </p>
          </div>
        </div>

        <div className="scene-review">
          <button className="scene-file-header" type="button">
            <ChevronDown size={16} />
            <Code2 size={15} />
            <span>src/web/routes/MarketingHome.tsx</span>
            <b className="scene-add">+74</b>
            <b className="scene-del">-6</b>
          </button>
          <button
            className="scene-hidden"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide unchanged context' : '194 unmodified lines'}
          </button>
          <div className="scene-hunk">@@ -38,11 +38,20 @@ export function MarketingHome()</div>
          {visibleDemoRows.map((row) => {
            const rowLine = row.side === 'L' ? row.oldLine : row.newLine;
            if (rowLine == null) {
              return null;
            }

            const selected = isSelectedLine(row.side, rowLine);
            return (
              <div key={row.key}>
                <button
                  className={`scene-row ${row.tone} ${row.hiddenUntilExpanded ? 'dimmed' : ''} ${selected ? 'selected' : ''}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    selectLine({ side: row.side, startLine: rowLine, endLine: rowLine })
                  }
                >
                  <span>{row.oldLine ?? ''}</span>
                  <span>{row.newLine ?? ''}</span>
                  <code>{row.code || ' '}</code>
                </button>
                {renderLineComments(row.side, rowLine)}
                {composerOpen &&
                selectedLine.side === row.side &&
                selectedLine.endLine === rowLine ? (
                  <div className="scene-composer">
                    <div className="scene-composer-title">
                      <strong>{activeComment ? 'Review comment' : 'New local comment'}</strong>
                      <span>{selectedLabel}</span>
                    </div>
                    <textarea
                      aria-label={selectedLabel}
                      placeholder="Request change"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="scene-composer-actions">
                      <button
                        className="scene-secondary-action"
                        type="button"
                        onClick={() => {
                          setDraft('');
                          setActiveCommentId(null);
                          setComposerOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button type="button" disabled={!trimmedDraft} onClick={saveComment}>
                        {activeComment ? 'Update' : 'Comment'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="scene-feedback">
          <div className="feedback-title">
            <FileJson2 size={15} />
            <span>.gloss/reviews/01KS5/feedback.json</span>
          </div>
          <pre>{feedbackPreview}</pre>
        </div>
      </div>

      <div className="scene-submit">
        <span>
          {comments.length === 0
            ? 'No local comments yet'
            : submitState === 'submitted'
              ? `${comments.length} saved to feedback.json`
              : `${comments.length} local comment${comments.length === 1 ? '' : 's'} ready`}
        </span>
        <button
          type="button"
          disabled={comments.length === 0}
          onClick={() => setSubmitState('submitted')}
        >
          {submitState === 'submitted' ? <Check size={14} /> : <Play size={14} />}
          {submitState === 'submitted' ? 'Review submitted' : 'Submit review'}
        </button>
      </div>
    </section>
  );
}

function WorkflowStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="workflow-step">
      <span>{step}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function MarketingNav({ activeSection }: { activeSection: MarketingSectionId | null }) {
  const navItems: Array<{ id: MarketingSectionId; label: string }> = [
    { id: 'install', label: 'Install' },
    { id: 'skill', label: 'Skill' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'contract', label: 'Output' }
  ];

  return (
    <header className="marketing-nav-shell">
      <nav className="marketing-nav" aria-label="Gloss site">
        <a className="marketing-wordmark" href="/">
          <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
          Gloss
        </a>
        {navItems.map((item) => {
          const active = activeSection === item.id;
          return (
            <a
              href={`#${item.id}`}
              key={item.id}
              aria-current={active ? 'location' : undefined}
              data-active={active ? 'true' : undefined}
            >
              {item.label}
            </a>
          );
        })}
        <a href="/setup/">Agent setup</a>
      </nav>
    </header>
  );
}

export function MarketingHome() {
  const [activeSection, setActiveSection] = useState<MarketingSectionId | null>(null);

  useEffect(() => {
    const sections = marketingSectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));

    if (sections.length === 0) {
      return;
    }

    const updateActiveSection = () => {
      const navOffset = 96;
      const nextActive = sections.reduce<MarketingSectionId | null>((active, section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= navOffset && rect.bottom > navOffset && isMarketingSectionId(section.id)
          ? section.id
          : active;
      }, null);
      const nearPageBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      setActiveSection(nearPageBottom ? 'contract' : nextActive);
    };

    const observer = new IntersectionObserver(
      () => {
        updateActiveSection();
      },
      {
        rootMargin: '-96px 0px 0px 0px',
        threshold: [0, 0.15, 0.5, 1]
      }
    );

    for (const section of sections) {
      observer.observe(section);
    }
    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
  }, []);

  return (
    <main className="marketing-page">
      <MarketingNav activeSection={activeSection} />
      <section className="marketing-hero">
        <div className="hero-copy">
          <div className="hero-copy-main">
            <h1>Gloss</h1>
            <p className="hero-subtitle">Comment on local diffs before handing the tree back.</p>
            <p className="hero-body">
              Gloss opens your working-tree diff in a local browser and writes review comments back
              to `.gloss/reviews` as JSON and Markdown.
            </p>
            <div className="hero-actions">
              <a className="hero-primary" href="#install">
                Install with Homebrew
                <ArrowRight size={17} />
              </a>
              <a className="hero-secondary" href="/setup/">
                Agent setup
              </a>
            </div>
          </div>
          <aside className="hero-quickstart" aria-label="Quick start command">
            <span>Run without setup</span>
            <code>{npxCommand}</code>
            <CopyButton value={npxCommand} label="Copy command" />
          </aside>
        </div>
        <HeroDiffScene />
      </section>

      <section className="marketing-band install-band" id="install">
        <div className="section-heading">
          <p>Install</p>
          <h2>Start the review loop in one command.</h2>
        </div>
        <div className="install-grid">
          <CommandLine command={installCommand} />
          <CommandLine command={npmInstallCommand} />
          <CommandLine command={runCommand} />
          <CommandLine command={npxCommand} />
        </div>
        <div className="agent-prompt">
          <div>
            <Terminal size={18} />
            <span>Agent instruction</span>
          </div>
          <p>{agentPrompt}</p>
          <CopyButton value={agentPrompt} label="Copy instruction" />
        </div>
      </section>

      <section className="marketing-band skill-band" id="skill">
        <div className="section-heading">
          <p>Skill</p>
          <h2>Teach agents where to send feedback.</h2>
        </div>
        <div className="skill-layout">
          <div className="skill-copy">
            <h2>Claude Code skill</h2>
            <p>
              The skill opens Gloss, waits for review submission, reads `feedback.json`, fixes each
              comment, and runs the narrowest useful validation.
            </p>
            <a href="/skill/SKILL.md">View SKILL.md</a>
          </div>
          <div className="skill-commands">
            <CommandLine command={skillInstallCommand} />
            <CommandLine command="gloss this" />
          </div>
        </div>
      </section>

      <section className="marketing-band workflow-band" id="workflow">
        <div className="section-heading">
          <p>Workflow</p>
          <h2>A local loop for before-PR review.</h2>
        </div>
        <div className="workflow-grid">
          <WorkflowStep
            step="01"
            title="Change code"
            body="Staged, unstaged, or untracked edits."
          />
          <WorkflowStep step="02" title="Open Gloss" body="Run `gloss open --json --base HEAD`." />
          <WorkflowStep step="03" title="Comment" body="Line and range comments in the browser." />
          <WorkflowStep step="04" title="Fix" body="Read `.gloss/reviews/*/feedback.json`." />
        </div>
      </section>

      <section className="marketing-band contract-band" id="contract">
        <div className="section-heading">
          <p>Output</p>
          <h2>Structured feedback, written into the repo.</h2>
        </div>
        <div className="contract-layout">
          <pre>{`<repo>/.gloss/reviews/<reviewId>/
  meta.json
  diff.json
  feedback.json
  feedback.md`}</pre>
          <div className="contract-copy">
            <p>`feedback.json` is for agents. `feedback.md` is for humans.</p>
            <p>`gloss mcp` exposes review, watch, feedback, and resolve tools.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
