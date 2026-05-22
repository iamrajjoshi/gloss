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
        <p>Install the optional skill when you want `/gloss`-style behavior in Claude Code.</p>
        <pre>{`mkdir -p ~/.claude/skills/gloss
curl -fsSL https://getgloss.dev/skill/SKILL.md -o ~/.claude/skills/gloss/SKILL.md`}</pre>
        <p>
          The skill runs <code>gloss open --json --base HEAD</code>, waits for submission, reads the
          feedback file, fixes comments, and validates the change.
        </p>
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
        <pre>gloss open --json --base HEAD</pre>
        <p>
          Leave the command running. Gloss exits after the browser review is submitted and writes
          feedback under <code>.gloss/reviews/&lt;reviewId&gt;/</code>.
        </p>
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
