{pkgs}: let
  inherit (pkgs) lib;
  toolchain = pkgs.rust-bin.fromRustupToolchainFile ../rust-toolchain.toml;
  pnpm = pkgs.stdenvNoCC.mkDerivation {
    pname = "pnpm";
    version = "12.10.1";
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/pnpm/-/pnpm-12.10.1.tgz";
      hash = "sha512-ukCjfrGjcNYP6oxM8dNkwTvMzvUY6YrSvO6VT1OdONo3RY5YJho/pV4GUjRQ6g//+fSXsTW+QfLBXBZCusrObA==";
    };
    nativeBuildInputs = [pkgs.makeWrapper];
    installPhase = ''
      mkdir -p $out/lib/pnpm $out/bin
      cp -r . $out/lib/pnpm
      makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/pnpm --add-flags $out/lib/pnpm/bin/pnpm.cjs
    '';
  };
  wasmBindgen =
    if pkgs.stdenv.hostPlatform.system == "x86_64-darwin"
    then
      pkgs.stdenvNoCC.mkDerivation {
        pname = "wasm-bindgen-cli";
        version = "0.2.129";
        src = pkgs.fetchurl {
          url = "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.129/wasm-bindgen-0.2.129-x86_64-apple-darwin.tar.gz";
          hash = "sha256-fgKIeaaOxT2uFASLVcxSFfbfdbF6nBQm+sj6CG0yAv0=";
        };
        dontBuild = true;
        dontFixup = true;
        installPhase = "mkdir -p $out/bin; cp wasm-bindgen wasm-bindgen-test-runner $out/bin/";
      }
    else pkgs.wasm-bindgen-cli;
  common = {
    packages =
      [pkgs.nodejs_24 pnpm toolchain wasmBindgen pkgs.binaryen pkgs.pkg-config pkgs.openssl pkgs.git pkgs.cmake pkgs.ninja pkgs.python3 pkgs.llvmPackages.libclang]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [pkgs.gtk3 pkgs.webkitgtk_4_1 pkgs.libayatana-appindicator pkgs.pipewire pkgs.librsvg pkgs.xdotool]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [pkgs.cocoapods pkgs.xcodegen];
    LIBCLANG_PATH = "${pkgs.llvmPackages.libclang.lib}/lib";
    shellHook = ''
      export PATH="$PWD/node_modules/.bin:$PATH"
      export SABLE_BUILD_FLAVOR=fork
      export VITE_APP_VERSION=2.0.2
    '';
  };
  android = pkgs.androidenv.composeAndroidPackages {
    platformVersions = ["36"];
    buildToolsVersions = ["35.0.0"];
    includeNDK = true;
    ndkVersions = ["29.0.14206865"];
    includeEmulator = false;
    includeSystemImages = false;
  };
in
  {
    default = pkgs.mkShell common;
    web = pkgs.mkShell common;
    android = pkgs.mkShell (common
      // {
        packages = [(toolchain.override {targets = ["wasm32-unknown-unknown" "aarch64-linux-android" "armv7-linux-androideabi"];}) android.androidsdk pkgs.jdk21] ++ lib.remove toolchain common.packages;
        ANDROID_HOME = "${android.androidsdk}/libexec/android-sdk";
        ANDROID_NDK_HOME = "${android.androidsdk}/libexec/android-sdk/ndk/29.0.14206865";
        JAVA_HOME = pkgs.jdk21.home;
      });
  }
  // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
    ios = pkgs.mkShell (common // {packages = [(toolchain.override {targets = ["wasm32-unknown-unknown" "aarch64-apple-ios" "aarch64-apple-ios-sim"];})] ++ lib.remove toolchain common.packages;});
  }
