{
  description = "Sable v2: desktop, web, mobile artifacts and native development tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/f08fce3b410dd681929b47a710eac4251e9dfa0d";
    # Unstable dropped Intel macOS; retain the supported 26.05 package set.
    nixpkgs-intel.url = "github:NixOS/nixpkgs/d70a468dc082082bedc027275b3b49ac7007c938";
    rust-overlay = {
      url = "github:oxalica/rust-overlay/74cebce67ef6671ea48fda353a5be2d229bd2920";
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
