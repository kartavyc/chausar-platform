#!/bin/sh
# Chausar launcher stub (Linux; macOS is experimental). Installed as <installRoot>/chausar-launcher by
# `update-launch.ts adopt`, in front of <installRoot>/versions/<version>/ and <installRoot>/current.json.
#
# The stub never edits current.json. An installed Chausar executable, run in Node mode, resolves the
# launch with the app's own InstallLayout (shared lock, full validation): it counts one launch of a
# version on trial and, after two launches the new version never confirmed, returns the pointer to the
# previous version. While a version is on trial its predecessor resolves first, so a broken new build
# cannot block its own rollback. The stub then replaces itself with the chosen executable.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
name=${CHAUSAR_EXECUTABLE_NAME:-chausar}
case $name in
  ''|.*|*/*|*[!A-Za-z0-9._-]*) echo "Chausar launcher: LAUNCH_EXECUTABLE_INVALID: the executable name is not plain." >&2; exit 64 ;;
esac
pointer=$root/current.json
if [ ! -f "$pointer" ] || [ -L "$pointer" ]; then
  echo "Chausar launcher: LAUNCH_NOT_INSTALLED: no installed version was found next to this launcher." >&2; exit 66
fi
# Only picks which installed copy runs the resolver; the resolver re-reads and validates the pointer.
field() { sed -n "s/.*\"$1\":\"\([0-9A-Za-z.+-]*\)\".*/\1/p" "$pointer" | head -n 1; }
current=$(field version); previous=$(field previous); state=$(field state)
if [ "$state" = trial ] && [ -n "$previous" ]; then order="$previous $current"; else order="$current $previous"; fi

host=''; resolver=''
find_host() {
  host=''; resolver=''
  for candidate in "$root/versions/$1/$name" "$root/versions/$1"/*/"$name" "$root/versions/$1"/*.app/Contents/MacOS/*; do
    [ -f "$candidate" ] && [ -x "$candidate" ] || continue
    app=$(dirname -- "$candidate")
    for script in "$app/resources/app.asar.unpacked/platform/runtime/native/update-launch.ts" "$app/../Resources/app.asar.unpacked/platform/runtime/native/update-launch.ts"; do
      if [ -f "$script" ]; then host=$candidate; resolver=$script; return 0; fi
    done
  done
  return 1
}

decision=''
for version in $order; do
  find_host "$version" || continue
  if decision=$(ELECTRON_RUN_AS_NODE=1 "$host" "$resolver" resolve --install-root "$root" --executable-name "$name"); then break; fi
  decision=''
done
if [ -z "$decision" ]; then
  echo "Chausar launcher: LAUNCH_UNRESOLVED: no installed version could resolve the launch. Reinstall Chausar." >&2; exit 70
fi
value() { printf '%s\n' "$decision" | sed -n "s/^$1=//p" | head -n 1; }
target=$(value executable)
if [ "$(value rolledBack)" = true ]; then
  echo "Chausar launcher: version $(value rolledBackFrom) did not confirm a clean start twice; returned to $(value version)." >&2
fi
if [ "$(value rollbackUnavailable)" = true ]; then
  echo "Chausar launcher: version $(value version) has not confirmed a clean start and no earlier version is installed." >&2
fi
if [ -z "$target" ] || [ ! -x "$target" ]; then
  echo "Chausar launcher: LAUNCH_EXECUTABLE_MISSING: the chosen version holds no app executable." >&2; exit 70
fi
unset ELECTRON_RUN_AS_NODE
CHAUSAR_INSTALL_ROOT=$root
export CHAUSAR_INSTALL_ROOT
exec "$target" "$@"
