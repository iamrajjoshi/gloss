import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import open from 'open';
import type { OpenFileTarget, OpenFileTargetInfo } from '../shared/types';

const execFileAsync = promisify(execFile);

const applicationRoots = [
  '/Applications',
  path.join(homedir(), 'Applications'),
  '/System/Applications',
  '/System/Applications/Utilities'
];

interface OpenFileTargetDescriptor extends OpenFileTargetInfo {
  appName?: string | readonly string[];
  opensFolder?: boolean;
}

const openFileTargetDescriptors: OpenFileTargetDescriptor[] = [
  { appName: 'Visual Studio Code', label: 'VS Code', target: 'vscode' },
  {
    appName: ['Visual Studio Code - Insiders', 'Code - Insiders'],
    label: 'VS Code Insiders',
    target: 'vscode-insiders'
  },
  { appName: 'VSCodium', label: 'VSCodium', target: 'vscodium' },
  { appName: 'Cursor', label: 'Cursor', target: 'cursor' },
  { appName: 'Sublime Text', label: 'Sublime Text', target: 'sublime' },
  { appName: 'Zed', label: 'Zed', target: 'zed' },
  { appName: 'Windsurf', label: 'Windsurf', target: 'windsurf' },
  { appName: 'WebStorm', label: 'WebStorm', target: 'webstorm' },
  {
    appName: ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA CE'],
    label: 'IntelliJ IDEA',
    target: 'intellij'
  },
  { appName: ['PyCharm', 'PyCharm CE'], label: 'PyCharm', target: 'pycharm' },
  { appName: 'GoLand', label: 'GoLand', target: 'goland' },
  { appName: 'PhpStorm', label: 'PhpStorm', target: 'phpstorm' },
  { appName: 'RubyMine', label: 'RubyMine', target: 'rubymine' },
  { appName: 'CLion', label: 'CLion', target: 'clion' },
  { appName: 'DataGrip', label: 'DataGrip', target: 'datagrip' },
  { appName: 'Android Studio', label: 'Android Studio', target: 'android-studio' },
  { appName: 'Fleet', label: 'Fleet', target: 'fleet' },
  { appName: 'Neovide', label: 'Neovide', target: 'neovide' },
  { appName: 'MacVim', label: 'MacVim', target: 'macvim' },
  { appName: 'Emacs', label: 'Emacs', target: 'emacs' },
  { appName: 'Lapce', label: 'Lapce', target: 'lapce' },
  { appName: 'TextMate', label: 'TextMate', target: 'textmate' },
  { appName: 'BBEdit', label: 'BBEdit', target: 'bbedit' },
  { appName: 'CotEditor', label: 'CotEditor', target: 'coteditor' },
  { appName: 'Nova', label: 'Nova', target: 'nova' },
  { appName: 'TextEdit', label: 'TextEdit', target: 'textedit' },
  { appName: 'Terminal', label: 'Terminal', opensFolder: true, target: 'terminal' },
  { appName: ['iTerm', 'iTerm2'], label: 'iTerm2', opensFolder: true, target: 'iterm2' },
  { appName: 'Ghostty', label: 'Ghostty', opensFolder: true, target: 'ghostty' },
  { appName: 'Xcode', label: 'Xcode', target: 'xcode' },
  { label: 'Default app', target: 'default' },
  { label: 'Open in folder', opensFolder: true, target: 'folder' }
];

const openFileTargetDescriptorByTarget = new Map(
  openFileTargetDescriptors.map((descriptor) => [descriptor.target, descriptor])
);

export async function availableOpenFileTargets(): Promise<OpenFileTargetInfo[]> {
  const availability = await Promise.all(
    openFileTargetDescriptors.map(async (descriptor) =>
      descriptor.appName && !(await resolveAppPath(descriptor.appName)) ? null : descriptor
    )
  );
  return availability
    .filter((descriptor): descriptor is OpenFileTargetDescriptor => descriptor !== null)
    .map(({ label, target }) => ({ label, target }));
}

export async function openLocalPath(
  filePath: string,
  target: OpenFileTarget = 'default'
): Promise<void> {
  const descriptor = openFileTargetDescriptorByTarget.get(target);
  const openPath = descriptor?.opensFolder ? path.dirname(filePath) : filePath;
  const appName = descriptor?.appName;
  if (!appName) {
    await open(openPath, { wait: false });
    return;
  }

  const appPath = await resolveAppPath(appName);
  if (appPath) {
    await execFileAsync('open', ['-a', appPath, openPath]);
    return;
  }

  await open(openPath, { app: { name: appName }, wait: false });
}

async function resolveAppPath(appName: string | readonly string[]): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  const appNames = Array.isArray(appName) ? appName : [appName];
  for (const name of appNames) {
    for (const root of applicationRoots) {
      const appPath = path.join(root, `${name}.app`);
      try {
        await access(appPath);
        return appPath;
      } catch {
        // Try the next likely application location.
      }
    }
  }
  return null;
}
