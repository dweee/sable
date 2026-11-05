{
  stdenv,
  callPackage,
}:
callPackage (
  if stdenv.hostPlatform.isDarwin
  then ./darwin.nix
  # No verified Electron arm64 tarball yet: the 2.3.5 nightly's asset does
  # not match its SHA256SUMS. aarch64-linux keeps the Tauri/CEF nightly.
  else if stdenv.hostPlatform.isAarch64
  then ./linux-tauri.nix
  else ./linux-electron.nix
) {}
