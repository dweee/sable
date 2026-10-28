#!/usr/bin/env python3
"""Credential-free behavior checks for the Attic output planner."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


plan = load('attic_plan', 'attic-plan.py')
push = load('push_attic', 'push-attic.py')

REVISION = 'a' * 40
SABLE = '/nix/store/' + 'b' * 32 + '-sable-2.0.3'
WEB = '/nix/store/' + 'c' * 32 + '-sable-web-2.0.3'
DRV = '/nix/store/' + 'd' * 32 + '-sable-2.0.3.drv'


class Nix:
    """Answers the planner's git and nix commands from fixed fixtures."""

    def __init__(self, dirty='', head=REVISION, system='x86_64-linux', built=None):
        self.dirty, self.head, self.system = dirty, head, system
        self.built = built or {'sable': [SABLE], 'sable-web': [WEB]}

    def __call__(self, *args):
        if args[:2] == ('git', 'rev-parse'):
            return self.head
        if args[:2] == ('git', 'status'):
            return self.dirty
        if args[:2] == ('nix', 'eval') and '--raw' in args:
            return self.system
        if args[:2] == ('nix', 'eval'):
            return json.dumps({'sable': {'drv': DRV, 'outputs': [SABLE]}, 'sable-web': {'drv': DRV, 'outputs': [WEB]}})
        if args[:2] == ('nix', 'build'):
            return '\n'.join(self.built[args[2].split('.')[-1].split('^')[0]])
        if args[:3] == ('nix', 'path-info', '--json'):
            return json.dumps({p: {'narHash': 'sha256-x', 'narSize': 7} for p in args[3:]})
        raise AssertionError(args)


class AtticPlanTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name) / 'out'

    def run_plan(self, nix, system='x86_64-linux', packages='sable sable-web'):
        with patch.object(plan, 'run', nix), patch.dict(os.environ, {'GITHUB_SHA': REVISION}):
            return plan.plan(system, packages, self.directory)

    def test_manifest_and_output_list_describe_exact_paths(self):
        manifest = self.run_plan(Nix())
        self.assertEqual(manifest['revision'], REVISION)
        self.assertEqual(manifest['packages']['sable']['outputs'], [SABLE])
        self.assertEqual(manifest['packages']['sable-web']['drvPath'], DRV)
        self.assertEqual(set(manifest['paths']), {SABLE, WEB})
        self.assertRegex(manifest['nixpkgs']['rev'], '^[a-f0-9]{40}$')
        self.assertEqual(json.loads((self.directory / 'manifest.json').read_text()), manifest)
        self.assertEqual((self.directory / 'outputs.txt').read_text().splitlines(), sorted([SABLE, WEB]))

    def test_output_list_is_accepted_by_the_publisher(self):
        self.run_plan(Nix())
        seen = []
        binary = self.directory / 'attic'
        binary.write_text('#!/bin/sh\nexit 0\n')
        binary.chmod(0o700)
        env = {'ATTIC_ENDPOINT': 'https://attic.monke.fail', 'ATTIC_CACHE': 'flakey',
               'ATTIC_TOKEN': 'dry-run-placeholder', 'ATTIC_BIN': str(binary), 'RUNNER_TEMP': str(self.directory)}

        def record(args, **kwargs):
            seen.append(kwargs['input'].splitlines())
            return type('Done', (), {'returncode': 0, 'stdout': ''})()
        with patch.dict(os.environ, env, clear=True), patch.object(push.subprocess, 'run', side_effect=record):
            push.publish(self.directory / 'outputs.txt')
        self.assertEqual(seen, [sorted([SABLE, WEB])] * 2)

    def test_dirty_tree_wrong_commit_and_wrong_runner_are_rejected(self):
        for nix in [Nix(dirty=' M flake.lock'), Nix(head='f' * 40), Nix(system='aarch64-linux')]:
            with self.subTest(nix=vars(nix)), self.assertRaises(plan.PlanError):
                self.run_plan(nix)
        self.assertFalse((self.directory / 'outputs.txt').exists())

    def test_build_that_differs_from_evaluation_is_rejected(self):
        other = '/nix/store/' + 'e' * 32 + '-sable-2.0.3'
        with self.assertRaises(plan.PlanError):
            self.run_plan(Nix(built={'sable': [other], 'sable-web': [WEB]}))
        self.assertFalse((self.directory / 'outputs.txt').exists())

    def test_only_fleet_systems_and_known_packages_are_accepted(self):
        with self.assertRaises(plan.PlanError):
            self.run_plan(Nix(system='x86_64-darwin'), system='x86_64-darwin')
        for packages in ['', 'sable sable', 'sable;id', 'default', '../sable']:
            with self.subTest(packages=packages), self.assertRaises(plan.PlanError):
                self.run_plan(Nix(), packages=packages)

    def test_dry_run_stub_prints_only_paths_and_arguments(self):
        import subprocess
        result = subprocess.run([str(HERE / 'attic-dry-run.sh'), 'push', '--stdin', 'ci:flakey'],
                                input=SABLE + '\n', text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout.splitlines(),
                         ['dry run: attic push --stdin ci:flakey', '  would push: ' + SABLE])


if __name__ == '__main__':
    unittest.main()
