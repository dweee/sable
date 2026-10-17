{fetchurl}: let
  release = builtins.fromJSON (builtins.readFile ./sources.json);
  asset = suffix: fetchurl release.sources.${suffix};
in {
  sable-windows = asset "windows-x86_64.msi";
  sable-android = asset "android-universal.apk";
  sable-android-aab = asset "android-universal.aab";
  sable-ios = asset "ios-arm64.ipa";
}
