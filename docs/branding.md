# Codex Coco identity

The mark pairs two rounded C shapes for Codex Coco: warm white and mint on a dark green tile. The overlapping shapes suggest a companion working alongside the main app. It borrows a restrained, geometric software-icon style; it does not copy or modify an OpenAI/Codex logo or bundle any OpenAI icon assets. Codex Coco is an independent project.

The original editable source is [icon.svg](../apps/desktop/src/renderer/assets/icon.svg). The generated [1024px PNG](../apps/desktop/resources/branding/icon.png) and [macOS ICNS](../apps/desktop/resources/branding/icon.icns) are committed so normal builds need no graphics tools. The ICNS contains 16, 32, 128, 256 and 512 point representations at both 1x and 2x. These original assets use the repository's MIT license.

Run `pnpm run icons:generate` on macOS after changing the SVG. The script renders the source with the project's Electron runtime, preserves transparent corners, generates each size, and uses the system iconutil. It uses a temporary data directory, removes it afterward, and adds no dependencies. Ordinary builds do not regenerate icons.

Finder, Dock and the DMG volume receive the ICNS through electron-builder's mac.icon setting. Development runs set the Dock image from the PNG; windows use the same PNG. The title bar, About dialog and repository READMEs use the same mark. Existing user-selected menu bar icons remain separate.

The published 0.1.0-preview.1 archive still has the default Electron icon. A future release must publish a new version through the existing Actions workflow; existing signed archives are not modified in place. The local icon-check DMG is an unsigned packaging check, not a signed public release.
