{ pkgs }:
let
  inherit (pkgs) lib;
  toolchain = pkgs.rust-bin.fromRustupToolchainFile ../rust-toolchain.toml;
  pnpmNative = pkgs.fetchurl (
    {
      x86_64-linux = {
        url = "https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.17.0.tgz";
        hash = "sha512-vQAusDzMofc/Ee4KOUYjE6FWeHOlMGQyvhR7W39QSamVeJWS16co/n+bhjdjwjI3UFh8IWOpamvTS+b4lvQUog==";
      };
      aarch64-linux = {
        url = "https://registry.npmjs.org/@pnpm/exe.linux-arm64/-/exe.linux-arm64-12.17.0.tgz";
        hash = "sha512-Cj2nIzWTVm6ZuhQHqL9SiJ11scBnEGxJyNg7tYQPzh9fVF5UVRkv+LbyfwdftnAtJerK/7HDpK/55WeQqp8OkA==";
      };
      x86_64-darwin = {
        url = "https://registry.npmjs.org/@pnpm/exe.darwin-x64/-/exe.darwin-x64-12.17.0.tgz";
        hash = "sha512-w89cboNi4KCzmt/dSKrE4ijVNKICKiZsE9TcIWf77Tz+VpoDfuhPSmWPZK+iCHBvlI/9dIN+M3HiPPVsFnAx4Q==";
      };
      aarch64-darwin = {
        url = "https://registry.npmjs.org/@pnpm/exe.darwin-arm64/-/exe.darwin-arm64-12.17.0.tgz";
        hash = "sha512-0nkEqRLIbrm7dWl+p2EPpmyNKyM0bbdPEovdtMhHYbhkO+Vls38S+6emkx8kSTAr75BNXYXkCl4RtGinGG4Erg==";
      };
    }
    .${pkgs.stdenv.hostPlatform.system}
  );
  pnpm = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
    pname = "pnpm";
    version = "12.17.0";
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/pnpm/-/pnpm-12.17.0.tgz";
      hash = "sha512-uNIj6+wEtYContIG2qcdG8y2oe4dUu+pXMOw23UnFWHfjw2OLEOt05xewIAYr3qKlRCOcJD5Win4hye3pA/VPQ==";
    };
    nativeBuildInputs = [
      pkgs.makeWrapper
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
    buildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
    dontStrip = true;
    dontFixup = pkgs.stdenv.hostPlatform.isDarwin;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/lib/pnpm" "$out/bin" native-pnpm
      cp -r . "$out/lib/pnpm/"
      tar -xzf ${pnpmNative} -C native-pnpm --strip-components=1 package/pnpm
      # The native command finds bundled node-gyp beside its executable.
      install -m755 native-pnpm/pnpm "$out/lib/pnpm/pnpm-native"
      makeWrapper "$out/lib/pnpm/pnpm-native" "$out/bin/pnpm" --prefix PATH : ${
        lib.makeBinPath [ pkgs.nodejs_24 ]
      }
      makeWrapper "$out/lib/pnpm/pnpm-native" "$out/bin/pnpx" --prefix PATH : ${
        lib.makeBinPath [ pkgs.nodejs_24 ]
      } --add-flags dlx
      ln -s pnpm "$out/bin/pn"
      ln -s pnpx "$out/bin/pnx"
      runHook postInstall
    '';
    doInstallCheck = true;
    installCheckPhase = lib.optionalString (pkgs.stdenv.buildPlatform.canExecute pkgs.stdenv.hostPlatform) ''
      runHook preInstallCheck
      pnpmSmokeHome="$(mktemp -d)"
      test "$(env HOME="$pnpmSmokeHome" "$out/bin/pnpm" --version)" = ${finalAttrs.version}
      mkdir pnpm-smoke
      cd pnpm-smoke
      # This dependency-free fixture checks execution without registry access.
      # A v12 packageManager pin also needs registry metadata in its env lock;
      # the application's frozen lock supplies that separately.
      echo '{"name":"sable-pnpm-smoke","version":"1.0.0","private":true,"scripts":{"verify-node":"node --version"}}' > package.json
      env HOME="$pnpmSmokeHome" CI=1 "$out/bin/pnpm" install --offline --ignore-scripts
      env HOME="$pnpmSmokeHome" CI=1 "$out/bin/pnpm" run verify-node
      echo '{"name":"sable-pnpm-mismatch","private":true,"packageManager":"pnpm@0.0.0"}' > package.json
      if env HOME="$pnpmSmokeHome" CI=1 "$out/bin/pnpm" install --offline --config.pm-on-fail=error > mismatch.log 2>&1; then
        echo "pnpm accepted a mismatched package-manager pin" >&2
        exit 1
      fi
      grep -F "This project is configured to use 0.0.0 of pnpm" mismatch.log
      runHook postInstallCheck
    '';
  });
  wasmBindgen =
    if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      pkgs.stdenvNoCC.mkDerivation {
        pname = "wasm-bindgen-cli";
        version = "0.2.130";
        src = pkgs.fetchurl {
          url = "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/wasm-bindgen-0.2.130-x86_64-apple-darwin.tar.gz";
          hash = "sha256-6yCcEVt8uVgyQjwao/TQbWxT9j73T8S2+3nvCy7qXxA=";
        };
        dontBuild = true;
        dontFixup = true;
        installPhase = "mkdir -p $out/bin; cp wasm-bindgen wasm-bindgen-test-runner $out/bin/";
      }
    else
      pkgs.wasm-bindgen-cli;
  common = {
    nativeBuildInputs = [ pkgs.rustPlatform.bindgenHook ];
    packages = [
      pkgs.nodejs_24
      pnpm
      toolchain
      wasmBindgen
      pkgs.binaryen
      pkgs.pkg-config
      pkgs.openssl
      pkgs.git
      pkgs.cmake
      pkgs.ninja
      pkgs.python3
      pkgs.llvmPackages.libclang
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
      pkgs.gtk3
      pkgs.webkitgtk_4_1
      pkgs.libayatana-appindicator
      pkgs.pipewire
      pkgs.librsvg
      pkgs.xdotool
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
      pkgs.cocoapods
      pkgs.xcodegen
    ];
    LIBCLANG_PATH = "${pkgs.llvmPackages.libclang.lib}/lib";
    shellHook = ''
      export PATH="$PWD/node_modules/.bin:$PATH"
      export SABLE_BUILD_FLAVOR=fork
      export SABLE_DISABLE_UPDATER=1
      export VITE_SABLE_DISABLE_UPDATER=1
      export VITE_APP_VERSION=2.3.8
    '';
  }
  // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
    # nextest executes test binaries outside Cargo's linker environment.
    # The loopback tests link PipeWire dynamically even without an audio server.
    LD_LIBRARY_PATH = lib.makeLibraryPath [ pkgs.pipewire ];
    # Match the locked Playwright 1.64.1 browser revisions, including WebKit
    # for the maintained iOS/Safari E2E projects; avoid mutable browser downloads.
    PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers.override {
      withFirefox = false;
    };
    PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = "ubuntu-24.04";
    CHROME = lib.getExe pkgs.chromium;
    CHROMEDRIVER = lib.getExe pkgs.chromedriver;
    WASM_BINDGEN_TEST_WEBDRIVER_JSON = pkgs.writeText "sable-wasm-webdriver.json" (
      builtins.toJSON {
        "goog:chromeOptions" = {
          binary = lib.getExe pkgs.chromium;
          args = [
            "--headless=new"
            "--disable-dev-shm-usage"
          ];
        };
      }
    );
  };
  android = pkgs.androidenv.composeAndroidPackages {
    platformVersions = [ "37.0" ];
    buildToolsVersions = [ "36.0.0" ];
    includeNDK = true;
    ndkVersions = [ "29.0.14206865" ];
    includeEmulator = false;
    includeSystemImages = false;
  };
in
{
  default = pkgs.mkShell common;
  web = pkgs.mkShell common;
  android = pkgs.mkShell (
    common
    // {
      packages = [
        (toolchain.override {
          targets = [
            "wasm32-unknown-unknown"
            "aarch64-linux-android"
            "armv7-linux-androideabi"
          ];
        })
        android.androidsdk
        pkgs.jdk25
      ]
      ++ lib.remove toolchain common.packages;
      ANDROID_HOME = "${android.androidsdk}/libexec/android-sdk";
      ANDROID_SDK_ROOT = "${android.androidsdk}/libexec/android-sdk";
      NDK_HOME = "${android.androidsdk}/libexec/android-sdk/ndk/29.0.14206865";
      ANDROID_NDK_HOME = "${android.androidsdk}/libexec/android-sdk/ndk/29.0.14206865";
      JAVA_HOME = pkgs.jdk25.home;
    }
  );
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
  ios = pkgs.mkShell (
    common
    // {
      packages = [
        (toolchain.override {
          targets = [
            "wasm32-unknown-unknown"
            "aarch64-apple-ios"
            "aarch64-apple-ios-sim"
          ];
        })
      ]
      ++ lib.remove toolchain common.packages;
    }
  );
}
