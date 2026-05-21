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
  Terminal
} from 'lucide-react';
import { useState } from 'react';

const installCommand = 'npm install -g getgloss';
const runCommand = 'gloss open --base HEAD --json';
const npxCommand = 'npx getgloss open --base HEAD --json';
const skillInstallCommand =
  'mkdir -p ~/.claude/skills/gloss && curl -fsSL https://getgloss.dev/skill/SKILL.md -o ~/.claude/skills/gloss/SKILL.md';
const agentPrompt = 'Install Gloss with npm. Then read https://getgloss.dev/setup.md.';

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
  const [commentOpen, setCommentOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

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
          <div className="scene-hunk">@@ -38,7 +38,13 @@ export function MarketingHome()</div>
          <div className="scene-row neutral">
            <span>38</span>
            <span>38</span>
            <code>const review = await gloss.open(&#123; base: 'HEAD' &#125;);</code>
          </div>
          {expanded ? (
            <div className="scene-row neutral dimmed">
              <span>39</span>
              <span>39</span>
              <code>const feedback = await review.waitForFeedback();</code>
            </div>
          ) : null}
          <div className="scene-row remove">
            <span>42</span>
            <span />
            <code>agent.resumeWithoutReview();</code>
          </div>
          <div className="scene-row add selected">
            <span />
            <span>44</span>
            <code>await agent.applyFeedback(feedback.comments);</code>
          </div>
          <button
            className="scene-comment"
            type="button"
            onClick={() => setCommentOpen((value) => !value)}
          >
            <MessageSquare size={14} />
            <span>Comment on line R44</span>
          </button>
          {commentOpen ? (
            <div className="scene-popover">
              <strong>Local comment</strong>
              <span>Comment on line R44</span>
              <p>Handle this comment before continuing.</p>
              <button type="button">Comment</button>
            </div>
          ) : null}
        </div>

        <div className="scene-feedback">
          <div className="feedback-title">
            <FileJson2 size={15} />
            <span>.gloss/reviews/01KS5/feedback.json</span>
          </div>
          <pre>{`{
  "reviewId": "01KS5...",
  "comments": [
    { "filePath": "src/web/...",
      "side": "R",
      "startLine": 44 }
  ]
}`}</pre>
        </div>
      </div>

      <div className="scene-submit">
        <span>1 local comment ready</span>
        <button type="button">
          <Play size={14} />
          Submit review
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

export function MarketingHome() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <nav className="marketing-nav" aria-label="Gloss site">
          <a className="marketing-wordmark" href="/">
            <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
            Gloss
          </a>
          <a href="#install">Install</a>
          <a href="#skill">Skill</a>
          <a href="#workflow">Workflow</a>
          <a href="#contract">Output</a>
          <a href="/setup/">Agent setup</a>
        </nav>
        <div className="hero-copy">
          <div className="hero-copy-main">
            <p className="hero-kicker">Local diff review for coding agents</p>
            <h1>Gloss</h1>
            <p className="hero-subtitle">Comment on local diffs before handing the tree back.</p>
            <p className="hero-body">
              Gloss opens your working-tree diff in a local browser and writes review comments back
              to `.gloss/reviews` as JSON and Markdown.
            </p>
            <div className="hero-actions">
              <a className="hero-primary" href="#install">
                Install with npm
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
        </div>
        <div className="install-grid">
          <CommandLine command={installCommand} />
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
