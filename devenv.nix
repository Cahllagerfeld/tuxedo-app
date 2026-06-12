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
  ];

  languages.javascript = {
    enable = true;
    npm = {
      enable = true;
    };
    pnpm = {
      enable = true;
    };
  };

  languages.rust = {
    enable = true;
  };

  languages.typescript = {
    enable = true;
  };

}
