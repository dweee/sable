#!/usr/bin/env python3
"""Build the Sable outputs the fleet installs and describe them for Attic.

Writes outputs.txt (the manifest for ci/push-attic.py) and manifest.json (the
revision, flake.lock digest, pinned nixpkgs and exact store paths) into the
chosen directory. It never reads or needs a credential.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SYSTEMS = ('x86_64-linux', 'aarch64-linux', 'aarch64-darwin')
# What the fleet installs, plus the web bundle. The windows/android/ios
# attributes are fixed-output downloads of public release assets; they can be
# requested explicitly but are not fleet-consumed.
DEFAULT_PACKAGES = ('sable', 'sable-web')
KNOWN_PACKAGES = DEFAULT_PACKAGES + ('sable-windows', 'sable-android', 'sable-android-aab', 'sable-ios')
STORE = re.compile(r'/nix/store/[0-9abcdfghijklmnpqrsvwxyz]{32}-[^/\s]+')
SHA = re.compile(r'[a-f0-9]{40}')
FLAGS = ['--option', 'accept-flake-config', 'false', '--no-update-lock-file', '--no-write-lock-file']


class PlanError(RuntimeError):
    pass


def run(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        # Nix diagnostics can be long; keep only the final error lines.
        lines = [line for line in (result.stderr or '').splitlines() if line.startswith('error:')]
        raise PlanError(' '.join(args[:3]) + ' failed: ' + ' | '.join(lines[-3:]))
    return result.stdout.strip()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def select(packages):
    names = packages.split() if isinstance(packages, str) else list(packages)
    if not names or len(set(names)) != len(names) or any(n not in KNOWN_PACKAGES for n in names):
        raise PlanError('Package list must be unique names from: ' + ' '.join(KNOWN_PACKAGES))
    return sorted(names)


def pinned_nixpkgs():
    """The locked nixpkgs revision that builds every fleet system's packages."""
    lock = json.loads((ROOT / 'flake.lock').read_text())
    locked = lock['nodes'][lock['nodes'][lock['root']]['inputs']['nixpkgs']]['locked']
    if not SHA.fullmatch(locked.get('rev', '')):
        raise PlanError('flake.lock does not pin nixpkgs by exact revision')
    return {'rev': locked['rev'], 'narHash': locked['narHash']}


def source_revision():
    revision = run('git', 'rev-parse', 'HEAD')
    expected = os.environ.get('GITHUB_SHA')
    if not SHA.fullmatch(revision) or (expected and expected != revision):
        raise PlanError('Checkout is not the triggering commit')
    # A dirty tracked tree would give a different flake than the one reviewed.
    if run('git', 'status', '--porcelain', '--untracked-files=no'):
        raise PlanError('Tracked files differ from the commit')
    return revision


def evaluate(system, names):
    wanted = '[' + ' '.join(json.dumps(n) for n in names) + ']'
    apply = ('p: builtins.listToAttrs (map (n: { name = n; value = { drv = p.${n}.drvPath; '
             'outputs = map (o: p.${n}.${o}.outPath) p.${n}.outputs; }; }) ' + wanted + ')')
    value = json.loads(run('nix', 'eval', '--json', '.#packages.' + system, '--apply', apply, *FLAGS))
    if set(value) != set(names):
        raise PlanError('Flake does not provide every requested package for ' + system)
    for entry in value.values():
        if not STORE.fullmatch(entry['drv']) or not entry['outputs'] or any(not STORE.fullmatch(o) for o in entry['outputs']):
            raise PlanError('Invalid evaluated store path')
    return value


def build(system, names, evaluated):
    roots = {}
    for name in names:
        built = run('nix', 'build', '.#packages.' + system + '.' + name + '^*', *FLAGS,
                    '--no-link', '--print-out-paths').splitlines()
        if sorted(built) != sorted(evaluated[name]['outputs']):
            raise PlanError(name + ' built to different paths than it evaluated to')
        roots[name] = sorted(built)
    return roots


def nar_info(paths):
    value = json.loads(run('nix', 'path-info', '--json', *paths))
    if isinstance(value, list):
        value = {entry['path']: entry for entry in value}
    result = {}
    for path in paths:
        entry = value.get(path) or {}
        if not isinstance(entry.get('narHash'), str) or type(entry.get('narSize')) is not int:
            raise PlanError('Missing NAR metadata for a built output')
        result[path] = {'narHash': entry['narHash'], 'narSize': entry['narSize']}
    return result


def plan(system, packages, directory):
    if system not in SYSTEMS:
        raise PlanError('System is not one the fleet consumes: ' + ', '.join(SYSTEMS))
    names = select(packages)
    revision = source_revision()
    lock_before = digest(ROOT / 'flake.lock')
    # The native check: a mismatched runner would otherwise cache foreign paths.
    if run('nix', 'eval', '--impure', '--raw', '--expr', 'builtins.currentSystem') != system:
        raise PlanError('Native runner required')
    evaluated = evaluate(system, names)
    roots = build(system, names, evaluated)
    paths = sorted({p for outputs in roots.values() for p in outputs})
    info = nar_info(paths)
    if digest(ROOT / 'flake.lock') != lock_before or run('git', 'rev-parse', 'HEAD') != revision:
        raise PlanError('Source changed during the build')
    manifest = {
        'version': 1,
        'revision': revision,
        'system': system,
        'flakeLockSha256': lock_before,
        'nixpkgs': pinned_nixpkgs(),
        'packages': {n: {'drvPath': evaluated[n]['drv'], 'outputs': roots[n]} for n in names},
        'paths': info,
    }
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'outputs.txt').write_text('\n'.join(paths) + '\n')
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as out:
            out.write('### ' + system + ' at `' + revision[:12] + '`\n\n')
            out.write('nixpkgs `' + manifest['nixpkgs']['rev'] + '`, flake.lock `' + lock_before[:12] + '`\n\n')
            out.write(''.join('- `' + p + '`\n' for p in paths))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--system', required=True)
    parser.add_argument('--packages', default=' '.join(DEFAULT_PACKAGES),
                        help='Space-separated package attributes')
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = plan(args.system, args.packages, args.directory)
    except (PlanError, OSError, KeyError, ValueError) as error:
        print('Attic plan failed: ' + str(error), file=sys.stderr)
        return 1
    print('Built ' + str(len(manifest['paths'])) + ' output path(s) for ' + args.system)
    return 0


if __name__ == '__main__':
    sys.exit(main())
