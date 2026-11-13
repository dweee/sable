{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  dpkg,
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
  glib,
  gtk3,
  libayatana-appindicator,
  libdrm,
  libgbm,
  libGL,
  libnotify,
  libpulseaudio,
  libsecret,
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
}: let
  pname = "sable";
  inherit (release) version;

  # These are the source-built fork's immutable, checksummed Electron assets.
  # moe.sable.next stays isolated from the legacy moe.sable.client installation.
  release = builtins.fromJSON (builtins.readFile ./sources-electron.json);
  arch =
    if stdenv.hostPlatform.isAarch64
    then "aarch64"
    else "x86_64";
  source = release.sources."linux-${arch}.deb";

  # dlopened at runtime: GL/Vulkan drivers, tray icon, notifications,
  # keyring, Wayland and call audio.
  runtimeLibs = [
    libGL
    libayatana-appindicator
    libdrm
    libnotify
    libpulseaudio
    libsecret
    pipewire
    systemdLibs
    wayland
  ];
in
  stdenv.mkDerivation {
    inherit pname version;

    src = fetchurl source;

    nativeBuildInputs = [
      autoPatchelfHook
      makeWrapper
      dpkg
      wrapGAppsHook3
    ];

    buildInputs = [
      alsa-lib
      at-spi2-atk
      at-spi2-core
      cairo
      cups
      dbus
      expat
      glib
      gtk3
      libgbm
      libpulseaudio
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
      pipewire
      stdenv.cc.cc.lib
      systemdLibs
    ];

    unpackPhase = ''
      runHook preUnpack
      test "$(dpkg-deb --field "$src" Package)" = sable-next
      test "$(dpkg-deb --field "$src" Architecture)" = ${
        if stdenv.hostPlatform.isAarch64
        then "arm64"
        else "amd64"
      }
      # Plain tar drops the setuid bit the sandbox would reject.
      dpkg-deb --fsys-tarfile $src | tar -x --no-same-owner --no-same-permissions
      runHook postUnpack
    '';

    dontConfigure = true;
    dontBuild = true;
    dontWrapGApps = true;

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/sable $out/bin
      cp -r "opt/Sable v2/." $out/lib/sable/
      cp -r usr/share $out/share
      substituteInPlace $out/share/applications/moe.sable.next.desktop \
        --replace-fail 'Exec="/opt/Sable v2/sable-next"' 'Exec=sable'
      # "deb" makes electron-updater try to install updates with pkexec dpkg;
      # without it the app treats itself as a tarball and never self-updates.
      rm -f $out/lib/sable/resources/package-type
      # The other architecture's screen-audio helper cannot be patched here.
      rm -f $out/lib/sable/resources/app.asar.unpacked/dist/venmic-${
        if stdenv.hostPlatform.isAarch64
        then "x64"
        else "arm64"
      }.node
      # A setuid helper cannot live in the store; Electron uses the user
      # namespace sandbox instead.
      rm -f $out/lib/sable/chrome-sandbox

      runHook postInstall
    '';

    # Deep-link registration runs update-desktop-database at startup.
    postFixup = ''
      makeWrapper $out/lib/sable/sable-next $out/bin/sable \
        --set SABLE_DISABLE_UPDATER 1 \
        --set SABLE_IDENTIFIER moe.sable.next \
        "''${gappsWrapperArgs[@]}" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath runtimeLibs}:${addDriverRunpath.driverLink}/lib \
        --prefix PATH : ${lib.makeBinPath [desktop-file-utils xdg-utils]}
    '';

    meta = {
      description = "Sable v2 Matrix client (Electron fork)";
      homepage = "https://git.monke.fail/d/sable";
      changelog = "https://github.com/dweee/sable/releases/tag/${release.tag}";
      license = lib.licenses.agpl3Plus;
      sourceProvenance = [lib.sourceTypes.binaryNativeCode];
      platforms = ["x86_64-linux" "aarch64-linux"];
      mainProgram = "sable";
    };
  }
