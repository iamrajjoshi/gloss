import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Options {
  version: string;
  sha256: string;
  out: string;
}

function parseArgs(argv: string[]): Options {
  const options: Partial<Options> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--version') {
      options.version = value;
      index += 1;
    } else if (arg === '--sha256') {
      options.sha256 = value;
      index += 1;
    } else if (arg === '--out') {
      options.out = value;
      index += 1;
    }
  }

  if (!options.version || !options.sha256) {
    throw new Error(
      'Usage: pnpm homebrew:formula -- --version <version> --sha256 <sha256> [--out <path>]'
    );
  }

  return {
    version: options.version,
    sha256: options.sha256,
    out: options.out ?? 'packaging/homebrew/gloss.rb'
  };
}

function formula({ version, sha256 }: Pick<Options, 'version' | 'sha256'>): string {
  return `class Gloss < Formula
  desc "Local browser-based diff review for coding-agent loops"
  homepage "https://getgloss.dev"
  url "https://registry.npmjs.org/getgloss/-/getgloss-${version}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gloss --version")
  end
end
`;
}

const options = parseArgs(process.argv.slice(2));
await mkdir(path.dirname(options.out), { recursive: true });
await writeFile(options.out, formula(options));
process.stdout.write(`Wrote ${options.out}\n`);
