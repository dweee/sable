self: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.sable;
in {
  options.programs.sable = {
    enable = lib.mkEnableOption "Sable v2 Matrix client";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.sable;
      defaultText = lib.literalExpression "inputs.sable.packages.\${pkgs.stdenv.hostPlatform.system}.sable";
      description = "Sable desktop package.";
    };
  };
  config = lib.mkIf cfg.enable {environment.systemPackages = [cfg.package];};
}
