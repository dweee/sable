{
  lib,
  stdenvNoCC,
  fetchurl,
  jq,
  conf ? {},
}: let
  release = builtins.fromJSON (builtins.readFile ./sources.json);
in
  stdenvNoCC.mkDerivation {
    pname = "sable-web";
    inherit (release) version;
    src = fetchurl release.sources."web.tar.gz";
    sourceRoot = ".";
    nativeBuildInputs = [jq];
    dontBuild = true;
    dontConfigure = true;
    config = builtins.toJSON conf;
    passAsFile = ["config"];
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r . "$out/"
      jq -s '.[0] * .[1]' "$out/config.json" "$configPath" > "$out/config.json.new"
      mv "$out/config.json.new" "$out/config.json"
      test -f "$out/index.html"
      runHook postInstall
    '';
    meta = {
      description = "Sable v2 Matrix web client";
      homepage = "https://git.monke.fail/d/sable";
      license = lib.licenses.agpl3Plus;
      platforms = lib.platforms.unix;
    };
  }
