{
  description = "Sable v2: desktop, web, mobile artifacts and native development tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/66685dc1f140ff3ebd8fb39d1a30dfe472c5e665";
    # Unstable dropped Intel macOS; retain the supported 26.05 package set.
    nixpkgs-intel.url = "github:NixOS/nixpkgs/36173dbc6ff2b383c4d03b002fd1ea58e2e4dbcd";
    rust-overlay = {
      url = "github:oxalica/rust-overlay/6b29b8e8d3cc8ebda9342fbbcc7ac06eff58e2fb";
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
