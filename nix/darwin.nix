{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  python3,
}: let
  release = builtins.fromJSON (builtins.readFile ./sources.json);
in
  stdenvNoCC.mkDerivation {
    pname = "sable";
    inherit (release) version;
    src = fetchurl release.sources."macos-universal.app.tar.gz";
    sourceRoot = ".";
    nativeBuildInputs = [makeWrapper python3];
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications" "$out/bin"
      app=$(find . -maxdepth 1 -name '*.app' -type d -print -quit)
      test -n "$app"
      cp -R "$app" "$out/Applications/Sable v2.app"
      executable=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1], "rb"))["CFBundleExecutable"])' "$out/Applications/Sable v2.app/Contents/Info.plist")
      makeWrapper "$out/Applications/Sable v2.app/Contents/MacOS/$executable" "$out/bin/sable"
      runHook postInstall
    '';
    meta = {
      description = "Sable v2 Matrix client (universal macOS application)";
      homepage = "https://git.monke.fail/d/sable";
      license = lib.licenses.agpl3Plus;
      sourceProvenance = [lib.sourceTypes.binaryNativeCode];
      platforms = lib.platforms.darwin;
      mainProgram = "sable";
    };
  }
