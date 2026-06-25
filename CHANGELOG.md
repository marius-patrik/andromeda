# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-25

### Added

- Phase 0 audio engine spike using OpenDAW SDK inside a cross-origin isolated local Bun server.
- VS Code extension host with commands: New Project, Open Project, Show Timeline, Show Mixer, Show Piano Roll, Show Browser, Show Graph, Export Audio, and Open Settings.
- Custom editor provider for `.vsdaw` project bundles.
- Project bundle read/write utilities and JSON schema validation with Zod.
- Shared utilities: message protocol serialization, time conversion, peak generation, and project bundle handling.
- Jest unit tests for shared utilities with 70% line coverage threshold.
- Integration test scaffold using `@vscode/test-cli`.
- Smoke test script that installs the `.vsix` and verifies activation.
- CI workflow running lint, typecheck, unit tests, integration tests, and packaging on macOS, Ubuntu, and Windows.
- Release workflow triggered by tag pushes that builds a `.vsix`, creates a GitHub Release, and publishes to the VS Code Marketplace and Open VSX.
- Documentation: `docs/USAGE.md`, `CHANGELOG.md`, and `ThirdPartyNotices.txt`.

### Changed

- Updated `package.json` marketplace metadata (publisher, repository, icon, categories, keywords).

## [0.0.1] - 2026-06-25

### Added

- Initial repository scaffold with package.json, README, LICENSE, and Phase 0 build scripts.
