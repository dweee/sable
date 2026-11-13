{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  python3,
  unzip,
}: let
  release = builtins.fromJSON (builtins.readFile ./sources.json);
  arch =
    if stdenvNoCC.hostPlatform.isAarch64
    then "aarch64"
    else "x86_64";
in
  stdenvNoCC.mkDerivation {
    pname = "sable";
    inherit (release) version;
    src = fetchurl release.sources."macos-${arch}.zip";
    sourceRoot = ".";
    nativeBuildInputs = [makeWrapper python3 unzip];
    unpackPhase = ''
      runHook preUnpack
      mkdir source
      unzip -q "$src" -d source
      cd source
      runHook postUnpack
    '';
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications" "$out/bin"
      app=$(find . -maxdepth 1 -name '*.app' -type d -print -quit)
      test -n "$app"
      cp -R "$app" "$out/Applications/Sable v2.app"
      python3 -c 'import plistlib,sys; p=plistlib.load(open(sys.argv[1], "rb")); assert p["CFBundleIdentifier"] == "moe.sable.next", p["CFBundleIdentifier"]' "$out/Applications/Sable v2.app/Contents/Info.plist"
      executable=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1], "rb"))["CFBundleExecutable"])' "$out/Applications/Sable v2.app/Contents/Info.plist")
      makeWrapper "$out/Applications/Sable v2.app/Contents/MacOS/$executable" "$out/bin/sable" --set SABLE_DISABLE_UPDATER 1 --set SABLE_IDENTIFIER moe.sable.next
      runHook postInstall
    '';
    meta = {
      description = "Sable v2 Matrix client (native macOS Electron application)";
      homepage = "https://git.monke.fail/d/sable";
      license = lib.licenses.agpl3Plus;
      sourceProvenance = [lib.sourceTypes.binaryNativeCode];
      platforms = lib.platforms.darwin;
      mainProgram = "sable";
    };
  }
