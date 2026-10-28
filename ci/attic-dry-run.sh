#!/bin/sh
# Stand-in for the Attic client when publication is off or dry-run: ci/push-attic.py
# still validates its settings and manifest and writes its private config, but
# nothing leaves the runner. Only the fixed arguments and store paths are printed.
set -eu
echo "dry run: attic $*"
sed 's/^/  would push: /'
