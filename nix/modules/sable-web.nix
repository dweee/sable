self: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.sable-web;
  json = pkgs.formats.json {};
  web = cfg.package.override {conf = cfg.settings;};
in {
  options.services.sable-web = {
    enable = lib.mkEnableOption "Sable v2 static web server";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.sable-web;
      defaultText = lib.literalExpression "inputs.sable.packages.\${pkgs.stdenv.hostPlatform.system}.sable-web";
      description = "Sable web package with a conf override.";
    };
    settings = lib.mkOption {
      type = json.type;
      default = {};
      example = {
        homeserverList = ["matrix.example.org"];
        defaultHomeserver = 0;
      };
      description = "Public config.json values merged with upstream defaults. Do not put secrets here.";
    };
    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Listen address.";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "HTTP listen port.";
    };
  };
  config = lib.mkIf cfg.enable {
    systemd.services.sable-web = {
      description = "Sable v2 web client";
      wantedBy = ["multi-user.target"];
      after = ["network.target"];
      serviceConfig = {
        ExecStart = "${pkgs.darkhttpd}/bin/darkhttpd ${web} --addr ${cfg.listenAddress} --port ${toString cfg.port} --fallback index.html";
        DynamicUser = true;
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        Restart = "on-failure";
      };
    };
  };
}
