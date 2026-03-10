@echo off
setlocal
set "REPO_ROOT=%~dp0.."
set "SOLANA_BIN=%REPO_ROOT%\.tools\solana-v2.3.13-extracted\solana-release\bin"
set "CARGO_BUILD_SBF_EXE=%SOLANA_BIN%\cargo-build-sbf.exe"

if not exist "%CARGO_BUILD_SBF_EXE%" (
  echo cargo-build-sbf.exe not found: %CARGO_BUILD_SBF_EXE% 1>&2
  exit /b 1
)

"%CARGO_BUILD_SBF_EXE%" --skip-tools-install %*
exit /b %ERRORLEVEL%
