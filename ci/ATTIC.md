# Private flakey cache publication

`.github/workflows/attic.yml` uploads the Sable outputs the fleet installs to the
private Attic cache `https://attic.monke.fail/flakey` (signing key
`flakey:mDx4DiNpH5w1Pl8OAKFFWq1ZsypA9lbaFKNiRWhqYE8=`). `ci/push-attic.py` is the
same publisher the other owning repositories use. It accepts no other endpoint or
cache. Sable has no private inputs and the workflow receives none.

## Configuration (names only)

| Kind | Name | Value |
| --- | --- | --- |
| variable | `ATTIC_PUSH_ENABLED` | `true` turns uploads on; unset or anything else keeps every run a dry run |
| variable | `ATTIC_ENDPOINT` | `https://attic.monke.fail` (default if unset) |
| variable | `ATTIC_CACHE` | `flakey` (default if unset) |
| secret | `ATTIC_TOKEN` | repository-scoped token, `--pull flakey --push flakey`, at most 30 days, subject `github-sable` |

Mint and install the token with `scripts/setup-github-attic.py --rotate --repo sable`
in the private Flakey checkout (it needs a `sable` entry in its repository list). The
helper sets the endpoint and cache variables and never changes `ATTIC_PUSH_ENABLED`.

## When the credential is available

Only a push to `main` or a manual dispatch from `main` can upload, and only when
`ATTIC_PUSH_ENABLED` is `true`. The workflow has no `pull_request` trigger, so pull
requests never see the secret. It is named in one step and removed from the
publisher's child environment, written to a mode-0600 temporary Attic config and
deleted afterwards. Nix never receives it: reads need no authentication and the build
uses the public cache only.

## What is uploaded

`sable` and `sable-web` for `x86_64-linux`, `aarch64-linux` and `aarch64-darwin`, the
systems the private fleet installs Sable on. A dispatch can add `sable-windows`,
`sable-android`, `sable-android-aab` or `sable-ios`; these are fixed-output downloads of
public release assets that no host installs. Intel macOS is built by `nix.yml` but not
uploaded because nothing in the fleet uses it.

`ci/attic-plan.py` builds each package from the committed `flake.lock` (no lock
update or write), refuses a dirty tree, a checkout that is not the triggering commit
or a build that differs from its evaluation, then writes `outputs.txt` for the
publisher and `manifest.json` (revision, `flake.lock` digest, pinned nixpkgs, `drvPath`,
output paths, NAR hash and size). The manifest is attached to every run for 30 days.

## Path identity and nixpkgs drift

A store path is a function of the derivation, so it is only useful to a host if the
host evaluates the same derivation. The packages here use `callPackage`, and Flakey's
`overlays.sable` applies them to the host's own nixpkgs, not the one in this
`flake.lock`. The two currently produce the same paths, but that is a property of
the two nixpkgs pins and not a guarantee. When Flakey's nixpkgs moves past a change to
one of the package's inputs (a glib, GTK, stdenv or `autoPatchelfHook` bump), its path
differs from the one cached here, and the host falls back to the substituters and
then builds locally. That build is only a download of the release tarball plus
patching, but the cache no longer helps. The fix on the Flakey side is to take the
packages from `inputs.sable.packages.<system>` instead of the overlay, or to compare
`pkgs.sable.outPath` with `inputs.sable.packages.<system>.sable.outPath` in a check.

## Dry run and local checks

A run with `ATTIC_PUSH_ENABLED` unset, or a dispatch with `dry_run` left at its default
of `true`, builds and describes everything and runs the real publisher with
`ci/attic-dry-run.sh` standing in for the Attic client. Nothing leaves the runner.

```sh
python3 ci/test-push-attic.py && python3 ci/test-attic-plan.py
python3 ci/attic-plan.py --system x86_64-linux --directory /tmp/attic   # needs a clean commit
```

Rotate the secret before the token expires. An upload is only a claim until the exact
narinfo and closure can be read back from the cache by a consumer.
