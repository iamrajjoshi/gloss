const skillInstallCommand = 'npx skills add iamrajjoshi/gloss --skill gloss -g -a claude-code';
const skillWorkflow = `1. Run gloss open --json from the repo root unless the user names a base ref.
2. Wait for the browser review to be submitted.
3. Read feedbackPath from the JSON output.
4. Address each comment in file and line order.
5. Validate the fix with the narrowest relevant checks.
6. Optionally mark individual comments handled:
   gloss resolve <reviewId> --comment <commentId> --summary "<what changed>"
7. Run gloss resolve <reviewId> --summary "<what changed>", then summarize what changed.`;

export function SetupPage() {
  return (
    <main className="setup-page">
      <nav className="setup-nav" aria-label="Gloss setup">
        <a className="marketing-wordmark" href="/">
          <img className="brand-mark" src="/logo.svg" alt="" aria-hidden="true" />
          Gloss
        </a>
        <a href="/setup.md">Raw setup.md</a>
      </nav>

      <header className="setup-header">
        <h1>Set up Gloss for agent reviews.</h1>
        <p>
          Install the CLI, then add the Gloss instruction block to the file your coding agent
          already reads.
        </p>
      </header>

      <section className="setup-section">
        <h2>Install</h2>
        <pre>brew install iamrajjoshi/tap/gloss</pre>
        <pre>npm install -g getgloss</pre>
        <pre>gloss help</pre>
      </section>

      <section className="setup-section">
        <h2>Agent Instruction</h2>
        <p>Give a new agent chat this instruction:</p>
        <pre>Install Gloss with Homebrew or npm. Then read https://getgloss.dev/setup.md.</pre>
      </section>

      <section className="setup-section">
        <h2>Claude Code Skill</h2>
        <p>
          Gloss ships a packaged skill at <code>skill/SKILL.md</code>. Install it when you want
          Claude Code to know when and how to use Gloss.
        </p>
        <pre>{skillInstallCommand}</pre>
        <p>The skill pairs the CLI with the browser app:</p>
        <pre>{skillWorkflow}</pre>
      </section>

      <section className="setup-section">
        <h2>Persistent Instructions</h2>
        <p>Add the canonical Gloss block to the instruction file your agent actually loads.</p>
        <pre>curl -fsSL https://getgloss.dev/prompt.md &gt;&gt; /absolute/path/to/AGENTS.md</pre>
        <ul>
          <li>
            Codex usually reads <code>$&#123;CODEX_HOME:-$HOME/.codex&#125;/AGENTS.md</code>.
          </li>
          <li>
            Claude Code usually reads <code>$HOME/.claude/CLAUDE.md</code>.
          </li>
          <li>
            Project-local agents often read <code>AGENTS.md</code> from the repo root.
          </li>
        </ul>
      </section>

      <section className="setup-section">
        <h2>Use</h2>
        <pre>gloss open --json</pre>
        <p>
          Leave the command running. Gloss exits after the browser review is submitted and writes
          feedback under <code>~/.gloss/reviews/&lt;reviewId&gt;/</code>.
        </p>
        <p>Start a fresh session with the same command for follow-up diffs.</p>
      </section>

      <section className="setup-note">
        <p>
          Agents should read <a href="/setup.md">/setup.md</a>. This page is the browser-friendly
          version.
        </p>
      </section>
    </main>
  );
}
