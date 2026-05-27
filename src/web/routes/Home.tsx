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
import { useMemo, useState } from 'react';
import { formatLineRange } from '../../shared/comments';

const installCommand = 'brew install iamrajjoshi/tap/gloss';
const npmInstallCommand = 'npm install -g getgloss';
const runCommand = 'gloss open --json';
const npxCommand = 'npx getgloss open --json';
const skillInstallCommand = 'npx skills add iamrajjoshi/gloss --skill gloss -g -a claude-code';

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

function labelForSelection(selection: DemoSelection): string {
  if (selection.startLine === selection.endLine) {
    return `Comment on line ${formatLineRange(selection)}`;
  }

  return `Comment on range ${formatLineRange(selection)}`;
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
  const submitted = submitState === 'submitted';
  const activeComment = comments.find((comment) => comment.id === activeCommentId);
  const selectedLabel = labelForSelection(selectedLine);
  const trimmedDraft = draft.trim();
  const commentLabel = `${comments.length} review comment${comments.length === 1 ? '' : 's'}`;
  const terminalLines = submitted
    ? [
        { marker: '✓', text: 'review.submitted received' },
        { marker: '→', text: 'reading ~/.gloss/reviews/01KS5/feedback.json' },
        { marker: '→', text: `applying ${commentLabel}` },
        { marker: '→', text: 'running pnpm check' }
      ]
    : [
        { marker: '$', text: 'gloss open --json' },
        { marker: '→', text: 'captured 4 files, +128 -31' },
        { marker: '→', text: 'waiting for review.submitted' }
      ];
  const visibleDemoRows = expanded
    ? demoCodeRows
    : demoCodeRows.filter((row) => !row.hiddenUntilExpanded);
  const feedbackPreview = useMemo(
    () =>
      JSON.stringify(
        {
          reviewId: '01KS5...',
          comments: comments.map((comment) => ({
            filePath: 'src/web/routes/Home.tsx',
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
    setSubmitState('idle');
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
    setSubmitState('idle');
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
            {terminalLines.map((line) => (
              <p key={line.text}>
                <span>{line.marker}</span> {line.text}
              </p>
            ))}
          </div>
        </div>

        <div className="scene-review">
          <button className="scene-file-header" type="button">
            <ChevronDown size={16} />
            <Code2 size={15} />
            <span>src/web/routes/Home.tsx</span>
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
          <div className="scene-hunk">@@ -38,11 +38,20 @@ export function Home()</div>
          {visibleDemoRows.map((row) => {
            const rowLine = row.side === 'L' ? row.oldLine : row.newLine;
            if (rowLine == null) {
              return null;
            }

            const selected = isSelectedLine(row.side, rowLine);
            const rejectedAfterSubmit =
              submitted && (row.key === 'skip-review' || row.key === 'skip-status');
            const appliedAfterSubmit =
              submitted && ['apply-feedback', 'resolve-threads', 'run-checks'].includes(row.key);
            return (
              <div key={row.key}>
                <button
                  className={`scene-row ${row.tone} ${row.hiddenUntilExpanded ? 'dimmed' : ''} ${selected ? 'selected' : ''} ${rejectedAfterSubmit ? 'agent-dimmed' : ''} ${appliedAfterSubmit ? 'agent-applied' : ''}`}
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
                {submitted && row.key === 'apply-feedback' ? (
                  <div className="scene-applied-status">
                    <Check size={13} />
                    <span>applied by agent</span>
                  </div>
                ) : null}
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
          {submitted ? (
            <>
              <div className="feedback-title">
                <Terminal size={15} />
                <span>agent is updating</span>
              </div>
              <div className="agent-update-card">
                <code>~/.gloss/reviews/01KS5/feedback.json</code>
                <ul>
                  {['Read feedback', 'Resolved comment', 'Validated'].map((item) => (
                    <li key={item}>
                      <Check size={13} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <>
              <div className="feedback-title">
                <FileJson2 size={15} />
                <span>~/.gloss/reviews/01KS5/feedback.json</span>
              </div>
              <pre>{feedbackPreview}</pre>
            </>
          )}
        </div>
      </div>

      <div className="scene-submit">
        <span>
          {comments.length === 0
            ? 'No local comments yet'
            : submitted
              ? 'Sent to agent'
              : `${comments.length} local comment${comments.length === 1 ? '' : 's'} ready`}
        </span>
        <button
          type="button"
          disabled={comments.length === 0}
          onClick={() => setSubmitState('submitted')}
        >
          {submitted ? <Check size={14} /> : <Play size={14} />}
          {submitted ? 'Sent to agent' : 'Submit review'}
        </button>
      </div>
    </section>
  );
}

function WorkflowStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="workflow-step">
      <span>{step}</span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function DemoVideoSection() {
  return (
    <section className="marketing-band demo-video-band" id="demo">
      <div className="demo-video-header">
        <div className="section-heading">
          <p>Demo</p>
          <h2>Watch the local review loop run for real.</h2>
        </div>
        <p className="demo-video-caption">
          A real pass through the loop: open a local diff, leave review comments, hand them back to
          the agent.
        </p>
      </div>
      <div className="demo-video-frame">
        <video
          aria-label="Gloss product walkthrough showing local diff review comments sent back to an agent"
          controls
          poster="/gloss-demo-poster.jpg"
          preload="metadata"
        >
          <source src="/gloss-demo.mp4" type="video/mp4" />
          <track
            default
            kind="captions"
            label="English"
            src="/gloss-demo-captions.vtt"
            srcLang="en"
          />
          Your browser does not support the video tag.
        </video>
      </div>
    </section>
  );
}

export function Home() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <div className="hero-copy">
          <div className="hero-copy-main">
            <div className="hero-logo">
              <img className="brand-mark" src="/logo-mark.svg" alt="Gloss logo" />
            </div>
            <h1>Gloss</h1>
            <p className="hero-subtitle">Review agent-written diffs in your browser.</p>
            <p className="hero-body">
              Gloss opens your working-tree diff in a local browser, then writes{' '}
              <code>feedback.json</code> for your agent and <code>feedback.md</code> for humans.
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

      <DemoVideoSection />

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
          <div className="agent-prompt-label">
            <Terminal size={18} />
            <span>Packaged skill</span>
          </div>
          <p>
            Install the bundled agent skill so Claude Code knows when to open Gloss and how to use
            the feedback.
          </p>
          <div className="agent-prompt-links">
            <a href="/setup/">Agent setup</a>
          </div>
          <div className="agent-skill-command">
            <code>{skillInstallCommand}</code>
            <CopyButton value={skillInstallCommand} label="Copy install" />
          </div>
        </div>
      </section>

      <section className="marketing-band workflow-band" id="workflow">
        <div className="section-heading">
          <p>How it works</p>
        </div>
        <div className="workflow-story">
          <WorkflowStep
            step="01"
            title="Open a review"
            body="The agent runs `gloss open --json`."
          />
          <WorkflowStep step="02" title="Wait" body="Gloss blocks while you review the diff." />
          <WorkflowStep step="03" title="Receive feedback" body="The agent reads `feedbackPath`." />
          <WorkflowStep
            step="04"
            title="Fix and validate"
            body="The agent applies comments and runs checks."
          />
          <WorkflowStep step="05" title="Resolve" body="The agent runs `gloss resolve`." />
        </div>
      </section>

      <section className="marketing-band contract-band" id="contract">
        <div className="section-heading">
          <p>Output</p>
          <h2>What the agent reads.</h2>
        </div>
        <div className="contract-layout">
          <pre>{`~/.gloss/reviews/<reviewId>/feedback.json
~/.gloss/reviews/<reviewId>/feedback.md
~/.gloss/reviews/<reviewId>/resolved.json`}</pre>
          <div className="contract-copy">
            <p>
              <code>feedback.json</code> is the machine-readable handoff; <code>feedback.md</code>{' '}
              is the human-readable copy; <code>resolved.json</code> tracks comment and review
              resolution progress.
            </p>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <a href="https://github.com/iamrajjoshi/gloss" target="_blank" rel="noreferrer">
          <GitBranch size={16} />
          <span>GitHub</span>
        </a>
      </footer>
    </main>
  );
}
