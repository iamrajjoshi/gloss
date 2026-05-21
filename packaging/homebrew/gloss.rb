class Gloss < Formula
  desc "Local browser-based diff review for coding-agent loops"
  homepage "https://getgloss.dev"
  url "https://registry.npmjs.org/getgloss/-/getgloss-0.1.0.tgz"
  sha256 "REPLACE_WITH_RELEASE_SHA256"
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

