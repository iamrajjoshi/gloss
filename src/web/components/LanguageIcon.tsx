import { FileCode2 } from 'lucide-react';
import {
  type SimpleIcon,
  siCss,
  siGnubash,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siMarkdown,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSwift,
  siTypescript,
  siYaml
} from 'simple-icons';

interface LanguageIconDefinition {
  color: string;
  icon: SimpleIcon;
}

const languageIcons: Record<string, SimpleIcon> = {
  bash: siGnubash,
  css: siCss,
  go: siGo,
  html: siHtml5,
  js: siJavascript,
  json: siJson,
  jsx: siReact,
  markdown: siMarkdown,
  python: siPython,
  ruby: siRuby,
  rust: siRust,
  swift: siSwift,
  ts: siTypescript,
  tsx: siReact,
  yaml: siYaml
};

export function languageIconForLanguage(
  language: string | null,
  isBinary = false
): LanguageIconDefinition | null {
  if (!language || isBinary) {
    return null;
  }

  const icon = languageIcons[language];
  return icon ? { icon, color: readableIconColor(icon.hex) } : null;
}

export function LanguageIcon({
  isBinary = false,
  language
}: {
  isBinary?: boolean;
  language: string | null;
}) {
  const languageIcon = languageIconForLanguage(language, isBinary);

  if (!languageIcon) {
    return (
      <span aria-hidden="true" className="file-language-icon" title="File">
        <FileCode2 size={17} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="file-language-icon"
      style={{ color: languageIcon.color }}
      title={`${languageIcon.icon.title} file`}
    >
      <svg
        aria-hidden="true"
        className="file-language-icon-svg"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d={languageIcon.icon.path} />
      </svg>
    </span>
  );
}

function readableIconColor(hex: string): string {
  const normalizedHex = hex.trim().replace(/^#/, '');
  if (!/^[\dA-Fa-f]{6}$/.test(normalizedHex)) {
    return 'currentColor';
  }

  const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  if (luminance < 0.15 || luminance > 0.9) {
    return 'currentColor';
  }

  return `#${normalizedHex}`;
}
