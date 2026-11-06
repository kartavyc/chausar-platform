// The rule for a path Chausar reads or runs on this computer (a cut, whisper-cli, its model): a full local path, never
// a network share, and on Windows a drive letter path. Kept on its own so the venture intake can use it without
// loading the speech service.

/**
 * Why a path is not a plain file on this computer, or null when it is: it must be a full path, never a network share
 * (\\server or //server), and on Windows it must start with a drive letter.
 */
export function localPathProblem(path: unknown, platform: string = process.platform): string | null {
  if (typeof path !== 'string' || !path || path.length > 500 || /[\u0000-\u001F\u007F]/.test(path)) return 'Give the full path to a file on this computer.';
  if (/^[\\/]{2}/.test(path)) return 'A file on a network share is not read. Copy it to this computer and give that path.';
  if (platform === 'win32' ? !/^[A-Za-z]:[\\/]/.test(path) : !path.startsWith('/')) {
    return platform === 'win32' ? 'Give the full path to a file on this computer, starting with a drive letter such as C:\\.' : 'Give the full path to a file on this computer, starting with /.';
  }
  return null;
}
