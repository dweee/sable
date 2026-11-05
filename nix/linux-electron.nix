{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
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

  # Upstream ships the Linux desktop app as Electron since v2.1.0; the
  # Tauri/CEF shell was removed in 0d820d595. Nightlies keep the
  # moe.sable.next.nightly identity, so this does not touch the legacy
  # moe.sable.client data that stable v2 builds migrate in place.
  release = builtins.fromJSON (builtins.readFile ./sources-electron.json);
  source = release.sources."linux-x86_64.tar.gz";

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

  desktopItem = makeDesktopItem {
    name = "moe.sable.next.electron.Nightly";
    desktopName = "Sable Nightly";
    genericName = "Matrix Client";
    comment = "Sable v2 Matrix client";
    exec = "sable %U";
    icon = "sable";
    startupWMClass = "Sable Nightly";
    categories = ["Network" "InstantMessaging" "Chat"];
    mimeTypes = [
      "x-scheme-handler/moe.sable.next"
      "x-scheme-handler/matrix"
    ];
  };
in
  stdenv.mkDerivation {
    inherit pname version;

    src = fetchurl source;

    nativeBuildInputs = [
      autoPatchelfHook
      makeWrapper
      copyDesktopItems
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

    desktopItems = [desktopItem];

    dontConfigure = true;
    dontBuild = true;
    dontWrapGApps = true;

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/sable $out/bin
      cp -r . $out/lib/sable/
      # The other architecture's screen-audio helper cannot be patched here.
      rm -f $out/lib/sable/resources/app.asar.unpacked/dist/venmic-arm64.node
      # A setuid helper cannot live in the store; Electron uses the user
      # namespace sandbox instead.
      rm -f $out/lib/sable/chrome-sandbox

      for size in 192 512; do
        install -Dm644 resources/dist/icons/logo-''${size}x''${size}.png \
          $out/share/icons/hicolor/''${size}x''${size}/apps/sable.png
      done
      install -Dm644 resources/dist/icons/logo.svg \
        $out/share/icons/hicolor/scalable/apps/sable.svg

      runHook postInstall
    '';

    # Deep-link registration runs update-desktop-database at startup.
    postFixup = ''
      makeWrapper $out/lib/sable/sable-nightly $out/bin/sable \
        "''${gappsWrapperArgs[@]}" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath runtimeLibs}:${addDriverRunpath.driverLink}/lib \
        --prefix PATH : ${lib.makeBinPath [desktop-file-utils xdg-utils]}
    '';

    meta = {
      description = "Sable v2 Matrix client (Electron nightly)";
      homepage = "https://git.monke.fail/d/sable";
      changelog = "https://git.sable.moe/SableClient/sable-next/releases/tag/${release.tag}";
      license = lib.licenses.agpl3Plus;
      sourceProvenance = [lib.sourceTypes.binaryNativeCode];
      platforms = ["x86_64-linux"];
      mainProgram = "sable";
    };
  }
