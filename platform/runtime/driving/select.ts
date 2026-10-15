/**
 * Picks the desktop driver for this computer (WK-14, experimental). X11 on Linux when DISPLAY is
 * set, UI Automation on Windows, Accessibility on macOS. A Wayland-only Linux session (no DISPLAY)
 * and any other system get null: Wayland lets no program read or drive another's windows.
 * Making a driver starts nothing; each starts its helper or connection on first use.
 */
import type { DesktopDriver } from './driver.ts';
import { MacAxDriver } from './macos-ax.ts';
import { WindowsUiaDriver } from './windows-uia.ts';
import { X11Driver } from './x11/driver.ts';

export function selectDriver(input: { platform?: NodeJS.Platform; env: Record<string, string | undefined>; excludePids?: number[] }): DesktopDriver | null {
  const platform = input.platform ?? process.platform;
  const excludePids = input.excludePids ?? [];
  if (platform === 'linux') return input.env.DISPLAY ? new X11Driver({ env: input.env, excludePids }) : null;
  if (platform === 'win32') return new WindowsUiaDriver({ excludePids });
  if (platform === 'darwin') return new MacAxDriver({ excludePids });
  return null;
}
