import { platform } from "node:os";
import { $ } from "bun";
import type { BacklogConfig } from "../types/index.ts";

/**
 * Get the default editor based on the operating system
 */
function getPlatformDefaultEditor(): string {
	const os = platform();
	switch (os) {
		case "win32":
			return "notepad";
		case "darwin":
			// macOS typically has nano available
			return "nano";
		case "linux":
			return "nano";
		default:
			// Fallback to vi which is available on most unix systems
			return "vi";
	}
}

/**
 * Resolve the editor command based on configuration, environment, and platform defaults
 * Priority: EDITOR env var -> config.defaultEditor -> platform default
 */
export function resolveEditor(config?: BacklogConfig | null): string {
	// First check environment variable
	const editorEnv = process.env.EDITOR;
	if (editorEnv) {
		return editorEnv;
	}

	// Then check config
	if (config?.defaultEditor) {
		return config.defaultEditor;
	}

	// Finally use platform default
	return getPlatformDefaultEditor();
}

/**
 * Check if an editor command is available on the system
 */
export async function isEditorAvailable(editor: string): Promise<boolean> {
	try {
		// Try to run the editor with --version or --help to check if it exists
		// Split the editor command in case it has arguments
		const parts = editor.split(" ");
		const command = parts[0]!;

		// For Windows, just check if the command exists
		if (platform() === "win32") {
			try {
				await $`where ${command}`.quiet();
				return true;
			} catch {
				return false;
			}
		}

		// For Unix-like systems, use which
		try {
			await $`which ${command}`.quiet();
			return true;
		} catch {
			return false;
		}
	} catch {
		return false;
	}
}

/**
 * Open a file in the editor
 */
export async function openInEditor(filePath: string, config?: BacklogConfig | null): Promise<boolean> {
	const editor = resolveEditor(config);

	try {
		// Split the editor command in case it has arguments
		const parts = editor.split(" ");
		const command = parts[0]!;
		const args = [...parts.slice(1), filePath];

		// Use the new Bun shell API
		// Don't use .quiet() as it breaks interactive editors like vim/helix
		// The editor needs to inherit stdio to work properly
		try {
			await $`${command} ${args}`;
			return true;
		} catch {
			return false;
		}
	} catch (error) {
		console.error(`Failed to open editor: ${error}`);
		return false;
	}
}
