# Fleet cache publication

`.github/workflows/cache.yml` publishes the Sable outputs the private fleet installs to
the private Niks3 cache at `https://niks3.monke.fail`. It runs only on a push to `main`
of `dweee/sable` or a manual dispatch, never for a pull request. The publisher requests
a GitHub OIDC write grant; no cache credential is stored in the repository. Uploads
also require the repository variable `NIKS3_PUSH_ENABLED=true`.

## What is uploaded

`sable` and `sable-web` for `x86_64-linux`, `aarch64-linux` and `aarch64-darwin`, the
systems the private fleet installs Sable on. A dispatch can add `sable-windows`,
`sable-android`, `sable-android-aab` or `sable-ios`; these are fixed-output downloads of
public release assets that no host installs. Intel macOS is built by `nix.yml` but not
uploaded because nothing in the fleet uses it.

`ci/cache-plan.py` builds each package from the committed `flake.lock` (no lock
update or write), refuses a dirty tree, a checkout that is not the triggering commit
or a build that differs from its evaluation, then writes `outputs.txt` for
`ci/push-niks3.py` and `manifest.json` (revision, `flake.lock` digest, pinned nixpkgs,
`drvPath`, output paths, NAR hash and size). The manifest is attached to every run for
30 days.

## Path identity and nixpkgs drift

A store path is a function of the derivation, so it is only useful to a host if the
host evaluates the same derivation. The packages here use `callPackage`, and Flakey's
`overlays.sable` applies them to the host's own nixpkgs, not the one in this
`flake.lock`. The two currently produce the same paths, but that is a property of
the two nixpkgs pins and not a guarantee. When Flakey's nixpkgs moves past a change to
one of the package's inputs, its path differs from the one cached here and the host
builds locally. The fix on the Flakey side is to take the packages from
`inputs.sable.packages.<system>` instead of the overlay, or to compare
`pkgs.sable.outPath` with `inputs.sable.packages.<system>.sable.outPath` in a check.

## Dry run and local checks

A run with `NIKS3_PUSH_ENABLED` unset, or a dispatch with `dry_run` left at its default
of `true`, builds and describes everything and uploads nothing.

```sh
python3 ci/test-push-niks3.py && python3 ci/test-cache-plan.py
python3 ci/cache-plan.py --system x86_64-linux --directory /tmp/cache   # needs a clean commit
```
