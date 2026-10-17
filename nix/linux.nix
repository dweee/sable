{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  wrapGAppsHook3,
  addDriverRunpath,
  alsa-lib,
  at-spi2-atk,
  at-spi2-core,
  cairo,
  cups,
  dbus,
  desktop-file-utils,
  expat,
  gdk-pixbuf,
  glib,
  gtk3,
  libayatana-appindicator,
  libdrm,
  libgbm,
  libGL,
  libpulseaudio,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxkbcommon,
  libxrandr,
  nspr,
  nss,
  pango,
  pipewire,
  systemdLibs,
  wayland,
  xdg-utils,
  jq,
}: let
  pname = "sable";
  inherit (release) version;

  # Use an immutable, complete nightly: stable upgrades the legacy app in place.
  release = builtins.fromJSON (builtins.readFile ./sources.json);
  arch =
    if stdenv.hostPlatform.isAarch64
    then "aarch64"
    else "x86_64";
  source = release.sources."linux-${arch}.tar.gz";

  # libcef.so's DT_NEEDED set. Rewriting its ELF headers (patchelf or strip)
  # makes CEF init fail and tauri exits with Err(Runtime(CreateWindow)), so
  # only the launcher is patched and the bundled .so files resolve these via
  # LD_LIBRARY_PATH.
  cefLibs = [
    alsa-lib
    at-spi2-atk
    at-spi2-core
    cairo
    cups
    dbus
    expat
    glib
    libgbm
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxkbcommon
    libxrandr
    nspr
    nss
    pango
    stdenv.cc.cc.lib
    systemdLibs
  ];

  # dlopened at runtime: GL/Vulkan drivers, tray icon, audio for calls.
  runtimeLibs = [
    libGL
    libayatana-appindicator
    libdrm
    libpulseaudio
    pipewire
    wayland
  ];
in
  stdenv.mkDerivation {
    inherit pname version;

    src = fetchurl source;

    sourceRoot = ".";

    nativeBuildInputs = [
      autoPatchelfHook
      makeWrapper
      wrapGAppsHook3
      jq
    ];

    buildInputs = [
      gdk-pixbuf
      glib
      gtk3
      stdenv.cc.cc.lib
    ];

    dontConfigure = true;
    dontBuild = true;
    dontWrapGApps = true;
    dontStrip = true;
    dontPatchELF = true;
    dontAutoPatchelf = true;

    # Same flat layout as the upstream .deb (/opt/sable): the binary has
    # RUNPATH=$ORIGIN and expects libcef.so and its .pak files beside it.
    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/sable $out/bin
      cp -r runtime/. $out/lib/sable/
      install -Dm755 sable-next $out/lib/sable/sable
      cp -r share $out/share
      for desktop in $out/share/applications/*.desktop; do
        substituteInPlace "$desktop" \
          --replace-fail 'Exec=sable-next' 'Exec=sable'
      done

      runHook postInstall
    '';

    # The deep-link setup hook runs update-desktop-database and panics
    # (os error 2) when it is missing.
    postFixup = ''
      addAutoPatchelfSearchPath $out/lib/sable
      autoPatchelf $out/lib/sable/sable
      makeWrapper $out/lib/sable/sable $out/bin/sable \
        "''${gappsWrapperArgs[@]}" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath (cefLibs ++ runtimeLibs)}:${addDriverRunpath.driverLink}/lib \
        --prefix PATH : ${lib.makeBinPath [desktop-file-utils xdg-utils]}
    '';

    meta = {
      description = "Sable v2 Matrix client (Tauri/CEF)";
      homepage = "https://git.monke.fail/d/sable";
      changelog = "https://git.sable.moe/SableClient/Sable-next/releases/tag/${release.tag}";
      license = lib.licenses.agpl3Plus;
      sourceProvenance = [lib.sourceTypes.binaryNativeCode];
      platforms = ["x86_64-linux" "aarch64-linux"];
      mainProgram = "sable";
    };
  }
