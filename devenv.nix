{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

{

  packages = [ 
    pkgs.git
    pkgs.github-cli
  ];

  languages.javascript = {
    enable = true;
     package = pkgs.nodejs-slim_24;
    npm = {
      enable = true;
    };
    pnpm = {
      enable = true;
    };
  };

  languages.typescript = {
    enable = true;
  };

}
