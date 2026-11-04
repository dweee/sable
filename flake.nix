{
  description = "Sable v2: desktop, web, mobile artifacts and native development tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/f5049481f2dda73ea838fec97300be9ecf89e054";
    # Unstable dropped Intel macOS; retain the supported 26.05 package set.
    nixpkgs-intel.url = "github:NixOS/nixpkgs/4ad2eda5f89410d94c57449a70d08935d9bbb4f6";
    rust-overlay = {
      url = "github:oxalica/rust-overlay/fb3eee9d296214ebbcc53921f34e80bb4166e859";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    nixpkgs-intel,
    rust-overlay,
  }: let
    systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
    eachSystem = nixpkgs.lib.genAttrs systems;
    nixpkgsFor = system:
      if system == "x86_64-darwin"
      then nixpkgs-intel
      else nixpkgs;
    packagesFor = pkgs: let
      artifacts = import ./nix/artifacts.nix {inherit (pkgs) fetchurl;};
    in
      artifacts
      // {
        sable = pkgs.callPackage ./nix/package.nix {};
        sable-web = pkgs.callPackage ./nix/web.nix {};
      };
  in {
    overlays.default = final: _: packagesFor final;
    packages = eachSystem (system: let
      packages = packagesFor (nixpkgsFor system).legacyPackages.${system};
    in
      packages // {default = packages.sable;});
    apps = eachSystem (system: {
      default = {
        type = "app";
        program = "${self.packages.${system}.sable}/bin/sable";
      };
    });
    checks = eachSystem (system: self.packages.${system});
    devShells = eachSystem (system: let
      pkgs = import (nixpkgsFor system) {
        inherit system;
        overlays = [rust-overlay.overlays.default];
        config.android_sdk.accept_license = true;
        config.allowUnfree = true;
      };
    in
      import ./nix/shells.nix {inherit pkgs;});
    nixosModules.default = self.nixosModules.sable;
    nixosModules.sable = import ./nix/modules/sable.nix self;
    nixosModules.sable-web = import ./nix/modules/sable-web.nix self;
    darwinModules.default = self.darwinModules.sable;
    darwinModules.sable = import ./nix/modules/sable.nix self;
    homeManagerModules.default = self.homeManagerModules.sable;
    homeManagerModules.sable = import ./nix/modules/home-manager.nix self;
  };
}
