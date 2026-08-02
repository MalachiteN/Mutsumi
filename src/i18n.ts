/**
 * @fileoverview Localization helper wrapping `vscode.l10n`.
 *
 * This re-exports `vscode.l10n.t` so call sites can use a short `t(...)`
 * import while keeping the bundle keys centralized in `l10n/`.
 *
 * Usage:
 * ```ts
 * import { t } from "./i18n";
 * vscode.window.showInformationMessage(t("clearToolCache.done"));
 * vscode.window.showErrorMessage(t("controller.mutsumiError", errorMessage));
 * ```
 *
 * @module i18n
 */

import * as vscode from "vscode";

/**
 * Translate a message string using the active VS Code locale.
 *
 * Pass the bundle key as the first argument. If the key is not found, the key
 * itself is returned. English text is provided by the default bundle
 * `l10n/bundle.l10n.json`, so every key must be defined there. Additional
 * positional arguments are substituted into `{0}`, `{1}`, ... placeholders
 * inside the translated string.
 *
 * @param message The bundle key (or literal message) to translate.
 * @param args Values to substitute into `{n}` placeholders.
 * @returns The localized string.
 */
export function t(
	message: string,
	...args: Array<string | number | boolean>
): string {
	return vscode.l10n.t(message, ...args);
}
