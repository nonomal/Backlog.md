#!/usr/bin/env node

import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import prompts from "prompts";
import { DEFAULT_DIRECTORIES } from "./constants/index.ts";
import { filterTasksByLatestState, getLatestTaskStatesForIds } from "./core/cross-branch-tasks.ts";
import { loadRemoteTasks, resolveTaskConflict, type TaskWithMetadata } from "./core/remote-tasks.ts";
import {
	type AgentInstructionFile,
	addAgentInstructions,
	Core,
	exportKanbanBoardToFile,
	initializeGitRepository,
	installClaudeAgent,
	isGitRepository,
	updateReadmeWithBoard,
} from "./index.ts";
import type { Decision, Document as DocType, Task } from "./types/index.ts";
import { genericSelectList } from "./ui/components/generic-list.ts";
import { createLoadingScreen } from "./ui/loading.ts";
import { formatTaskPlainText, viewTaskEnhanced } from "./ui/task-viewer.ts";
import { promptText, scrollableViewer } from "./ui/tui.ts";
import { getTaskFilename, getTaskPath } from "./utils/task-path.ts";
import { sortTasks } from "./utils/task-sorting.ts";
import { getVersion } from "./utils/version.ts";

// Windows color fix
if (process.platform === "win32") {
	const term = process.env.TERM;
	if (!term || /^(xterm|dumb|ansi|vt100)$/i.test(term)) {
		process.env.TERM = "xterm-256color";
	}
}

// Temporarily isolate BUN_OPTIONS during CLI parsing to prevent conflicts
// Save the original value so it's available for subsequent commands
const originalBunOptions = process.env.BUN_OPTIONS;
if (process.env.BUN_OPTIONS) {
	delete process.env.BUN_OPTIONS;
}

// Get version from package.json
const version = await getVersion();

// Global config migration - run before any command processing
// Only run if we're in a backlog project (skip for init, help, version)
const shouldRunMigration =
	!process.argv.includes("init") &&
	!process.argv.includes("--help") &&
	!process.argv.includes("-h") &&
	!process.argv.includes("--version") &&
	!process.argv.includes("-v") &&
	process.argv.length > 2; // Ensure we have actual commands

if (shouldRunMigration) {
	try {
		const cwd = process.cwd();
		const core = new Core(cwd);

		// Only migrate if config already exists (project is already initialized)
		const config = await core.filesystem.loadConfig();
		if (config) {
			await core.ensureConfigMigrated();
		}
	} catch (_error) {
		// Silently ignore migration errors - project might not be initialized yet
	}
}

const program = new Command();
program
	.name("backlog")
	.description("Backlog.md - Project management CLI")
	.version(version, "-v, --version", "display version number");

program
	.command("init [projectName]")
	.description("initialize backlog project in the current repository")
	.action(async (projectName?: string) => {
		try {
			const cwd = process.cwd();
			const isRepo = await isGitRepository(cwd);

			if (!isRepo) {
				const rl = createInterface({ input, output });
				const answer = (await rl.question("No git repository found. Initialize one here? [y/N] ")).trim().toLowerCase();
				rl.close();

				if (answer.startsWith("y")) {
					await initializeGitRepository(cwd);
				} else {
					console.log("Aborting initialization.");
					process.exit(1);
				}
			}

			const core = new Core(cwd);

			// Check if project is already initialized and load existing config
			const existingConfig = await core.filesystem.loadConfig();
			const isReInitialization = !!existingConfig;

			if (isReInitialization) {
				console.log("Existing backlog project detected. Current configuration will be preserved where not specified.");
			}

			// Get project name
			let name = projectName;
			if (!name) {
				const defaultName = existingConfig?.projectName || "";
				const promptMessage = isReInitialization && defaultName ? `Project name (${defaultName}):` : "Project name:";
				name = await promptText(promptMessage);
				// Use existing name if nothing entered during re-init
				if (!name && isReInitialization && defaultName) {
					name = defaultName;
				}
				if (!name) {
					console.log("Aborting initialization.");
					process.exit(1);
				}
			}

			// Configuration prompts with intelligent defaults - step by step to ensure proper order
			const basicPrompts = await prompts(
				[
					{
						type: "confirm",
						name: "autoCommit",
						message: "Enable automatic git commits for task operations?",
						hint: "When enabled, task changes are automatically committed to git",
						initial: existingConfig?.autoCommit ?? false,
					},
					{
						type: "confirm",
						name: "remoteOperations",
						message: "Enable remote git operations? (needed to fetch tasks from remote branches)",
						hint: "Required for accessing tasks from feature branches and remote repos",
						initial: existingConfig?.remoteOperations ?? true,
					},
					{
						type: "confirm",
						name: "enableZeroPadding",
						message: "Enable zero-padded IDs for consistent formatting? (3 -> task-001, task-023)",
						hint: "Example: task-001, doc-001 instead of task-1, doc-1",
						initial: (existingConfig?.zeroPaddedIds ?? 0) > 0,
					},
				],
				{
					onCancel: () => {
						console.log("Aborting initialization.");
						process.exit(1);
					},
				},
			);

			// Zero-padding configuration (conditional) - ask immediately after enable question
			let zeroPaddedIds: number | undefined;
			if (basicPrompts.enableZeroPadding) {
				const paddingPrompt = await prompts(
					{
						type: "number",
						name: "paddingWidth",
						message: "Number of digits for zero-padding:",
						hint: "e.g., 3 creates task-001, task-002; 4 creates task-0001, task-0002",
						initial: existingConfig?.zeroPaddedIds || 3,
						min: 1,
						max: 10,
					},
					{
						onCancel: () => {
							console.log("Aborting initialization.");
							process.exit(1);
						},
					},
				);

				if (paddingPrompt?.paddingWidth) {
					zeroPaddedIds = paddingPrompt.paddingWidth;
				}
			} else {
				// User chose not to enable padding
				zeroPaddedIds = 0;
			}

			// Web UI configuration prompt
			const webUIPrompt = await prompts(
				{
					type: "confirm",
					name: "configureWebUI",
					message: "Configure web UI settings?",
					hint: "Optional: Set custom port and browser behavior",
					initial: false,
				},
				{
					onCancel: () => {
						console.log("Aborting initialization.");
						process.exit(1);
					},
				},
			);

			// Web UI configuration (conditional) - ask immediately after enable question
			let webUIConfig: { defaultPort?: number; autoOpenBrowser?: boolean } = {};
			if (webUIPrompt.configureWebUI) {
				const webUIPrompts = await prompts(
					[
						{
							type: "number",
							name: "defaultPort",
							message: "Default web UI port:",
							hint: "Port number for the web interface (1-65535)",
							initial: existingConfig?.defaultPort ?? 6420,
							min: 1,
							max: 65535,
						},
						{
							type: "confirm",
							name: "autoOpenBrowser",
							message: "Automatically open browser when starting web UI?",
							hint: "When enabled, 'backlog web' automatically opens your browser",
							initial: existingConfig?.autoOpenBrowser ?? true,
						},
					],
					{
						onCancel: () => {
							console.log("Aborting initialization.");
							process.exit(1);
						},
					},
				);

				if (webUIPrompts !== undefined) {
					webUIConfig = webUIPrompts;
				}
			}

			// Combine all configuration responses
			const configPrompts = {
				...basicPrompts,
				configureWebUI: webUIPrompt.configureWebUI,
			};

			// Default editor configuration - always prompt during init
			const editorPrompt = await prompts(
				{
					type: "text",
					name: "editor",
					message: "Default editor command (optional):",
					hint: "e.g., 'code --wait', 'vim', 'nano'",
					initial: existingConfig?.defaultEditor || process.env.EDITOR || process.env.VISUAL || "",
				},
				{
					onCancel: () => {
						console.log("Aborting initialization.");
						process.exit(1);
					},
				},
			);

			let defaultEditor: string | undefined;
			if (editorPrompt?.editor) {
				const { isEditorAvailable } = await import("./utils/editor.ts");
				const isAvailable = await isEditorAvailable(editorPrompt.editor);
				if (isAvailable) {
					defaultEditor = editorPrompt.editor;
				} else {
					console.warn(`Warning: Editor command '${editorPrompt.editor}' not found in PATH`);
					// Still allow them to set it even if not found
					const confirmAnyway = await prompts(
						{
							type: "confirm",
							name: "confirm",
							message: "Editor not found in PATH. Set it anyway?",
							initial: false,
						},
						{
							onCancel: () => {
								console.log("Aborting initialization.");
								process.exit(1);
							},
						},
					);
					if (confirmAnyway?.confirm) {
						defaultEditor = editorPrompt.editor;
					}
				}
			}

			// Agent instruction files selection
			const agentOptions = [
				".cursorrules",
				"CLAUDE.md",
				"AGENTS.md",
				"GEMINI.md",
				".github/copilot-instructions.md",
			] as const;

			const { files: selected } = await prompts(
				{
					type: "multiselect",
					name: "files",
					message: "Select agent instruction files to update",
					choices: agentOptions.map((name) => ({
						title: name === ".github/copilot-instructions.md" ? "Copilot" : name,
						value: name,
					})),
					hint: "Space to select, Enter to confirm",
					instructions: false,
				},
				{
					onCancel: () => {
						console.log("Aborting initialization.");
						process.exit(1);
					},
				},
			);
			const files: AgentInstructionFile[] = (selected ?? []) as AgentInstructionFile[];

			// Claude agent installation prompt
			const claudeAgentPrompt = await prompts(
				{
					type: "confirm",
					name: "installClaudeAgent",
					message: "Install Claude Code Backlog.md agent for enhanced task management?",
					hint: "Adds specialized agent to .claude/agents for better Backlog.md integration",
					initial: true,
				},
				{
					onCancel: () => {
						console.log("Aborting initialization.");
						process.exit(1);
					},
				},
			);

			// Prepare configuration object preserving existing values
			const config = {
				projectName: name,
				statuses: existingConfig?.statuses || ["To Do", "In Progress", "Done"],
				labels: existingConfig?.labels || [],
				milestones: existingConfig?.milestones || [],
				defaultStatus: existingConfig?.defaultStatus || "To Do",
				dateFormat: existingConfig?.dateFormat || "yyyy-mm-dd",
				maxColumnWidth: existingConfig?.maxColumnWidth || 20,
				autoCommit: configPrompts.autoCommit,
				remoteOperations: configPrompts.remoteOperations,
				...(defaultEditor && { defaultEditor }),
				// Web UI config: use new values, preserve existing, or set defaults
				defaultPort:
					webUIConfig.defaultPort !== undefined
						? webUIConfig.defaultPort
						: existingConfig?.defaultPort !== undefined
							? existingConfig.defaultPort
							: 6420,
				autoOpenBrowser:
					webUIConfig.autoOpenBrowser !== undefined
						? webUIConfig.autoOpenBrowser
						: existingConfig?.autoOpenBrowser !== undefined
							? existingConfig.autoOpenBrowser
							: true,
				// Zero-padding config: only include if enabled (> 0)
				...(zeroPaddedIds && zeroPaddedIds > 0 && { zeroPaddedIds }),
			};

			// Show configuration summary
			console.log("\nConfiguration Summary:");
			console.log(`  Project Name: ${config.projectName}`);
			console.log(`  Auto Commit: ${config.autoCommit}`);
			console.log(`  Remote Operations: ${config.remoteOperations}`);
			if (config.defaultEditor) console.log(`  Default Editor: ${config.defaultEditor}`);
			if (config.defaultPort) console.log(`  Web UI Port: ${config.defaultPort}`);
			if (config.autoOpenBrowser !== undefined) console.log(`  Auto Open Browser: ${config.autoOpenBrowser}`);
			if (config.zeroPaddedIds) {
				console.log(`  Zero-Padded IDs: ${config.zeroPaddedIds} digits`);
			} else {
				console.log("  Zero-Padded IDs: disabled");
			}
			console.log(`  Statuses: [${config.statuses.join(", ")}]`);
			console.log("");

			// Initialize or update project
			if (isReInitialization) {
				await core.filesystem.saveConfig(config);
				console.log(`Updated backlog project configuration: ${name}`);
			} else {
				await core.filesystem.ensureBacklogStructure();
				await core.filesystem.saveConfig(config);
				await core.ensureConfigLoaded();
				console.log(`Initialized backlog project: ${name}`);
			}

			// Add agent instruction files if selected
			if (files.length > 0) {
				await addAgentInstructions(cwd, core.gitOps, files, config.autoCommit);
			}

			// Install Claude agent if selected
			if (claudeAgentPrompt.installClaudeAgent) {
				await installClaudeAgent(cwd);
				console.log("✓ Claude Code Backlog.md agent installed to .claude/agents/");
			}
		} catch (err) {
			console.error("Failed to initialize project", err);
			process.exitCode = 1;
		}
	});

export async function generateNextDocId(core: Core): Promise<string> {
	const config = await core.filesystem.loadConfig();
	// Load local documents
	const docs = await core.filesystem.listDocuments();
	const allIds: string[] = [];

	try {
		const backlogDir = DEFAULT_DIRECTORIES.BACKLOG;

		// Skip remote operations if disabled
		if (config?.remoteOperations === false) {
			if (process.env.DEBUG) {
				console.log("Remote operations disabled - generating ID from local documents only");
			}
		} else {
			await core.gitOps.fetch();
		}

		const branches = await core.gitOps.listAllBranches();

		// Load files from all branches in parallel
		const branchFilePromises = branches.map(async (branch) => {
			const files = await core.gitOps.listFilesInTree(branch, `${backlogDir}/docs`);
			return files
				.map((file) => {
					const match = file.match(/doc-(\d+)/);
					return match ? `doc-${match[1]}` : null;
				})
				.filter((id): id is string => id !== null);
		});

		const branchResults = await Promise.all(branchFilePromises);
		for (const branchIds of branchResults) {
			allIds.push(...branchIds);
		}
	} catch (error) {
		// Suppress errors for offline mode or other git issues
		if (process.env.DEBUG) {
			console.error("Could not fetch remote document IDs:", error);
		}
	}

	// Add local document IDs
	for (const doc of docs) {
		allIds.push(doc.id);
	}

	// Find the highest numeric ID
	let max = 0;
	for (const id of allIds) {
		const match = id.match(/^doc-(\d+)$/);
		if (match) {
			const num = Number.parseInt(match[1] || "0", 10);
			if (num > max) max = num;
		}
	}

	const nextIdNumber = max + 1;
	const padding = config?.zeroPaddedIds;

	if (padding && typeof padding === "number" && padding > 0) {
		const paddedId = String(nextIdNumber).padStart(padding, "0");
		return `doc-${paddedId}`;
	}

	return `doc-${nextIdNumber}`;
}

export async function generateNextDecisionId(core: Core): Promise<string> {
	const config = await core.filesystem.loadConfig();
	// Load local decisions
	const decisions = await core.filesystem.listDecisions();
	const allIds: string[] = [];

	try {
		const backlogDir = DEFAULT_DIRECTORIES.BACKLOG;

		// Skip remote operations if disabled
		if (config?.remoteOperations === false) {
			if (process.env.DEBUG) {
				console.log("Remote operations disabled - generating ID from local decisions only");
			}
		} else {
			await core.gitOps.fetch();
		}

		const branches = await core.gitOps.listAllBranches();

		// Load files from all branches in parallel
		const branchFilePromises = branches.map(async (branch) => {
			const files = await core.gitOps.listFilesInTree(branch, `${backlogDir}/decisions`);
			return files
				.map((file) => {
					const match = file.match(/decision-(\d+)/);
					return match ? `decision-${match[1]}` : null;
				})
				.filter((id): id is string => id !== null);
		});

		const branchResults = await Promise.all(branchFilePromises);
		for (const branchIds of branchResults) {
			allIds.push(...branchIds);
		}
	} catch (error) {
		// Suppress errors for offline mode or other git issues
		if (process.env.DEBUG) {
			console.error("Could not fetch remote decision IDs:", error);
		}
	}

	// Add local decision IDs
	for (const decision of decisions) {
		allIds.push(decision.id);
	}

	// Find the highest numeric ID
	let max = 0;
	for (const id of allIds) {
		const match = id.match(/^decision-(\d+)$/);
		if (match) {
			const num = Number.parseInt(match[1] || "0", 10);
			if (num > max) max = num;
		}
	}

	const nextIdNumber = max + 1;
	const padding = config?.zeroPaddedIds;

	if (padding && typeof padding === "number" && padding > 0) {
		const paddedId = String(nextIdNumber).padStart(padding, "0");
		return `decision-${paddedId}`;
	}

	return `decision-${nextIdNumber}`;
}

async function generateNextId(core: Core, parent?: string): Promise<string> {
	// Ensure git operations have access to the config
	await core.ensureConfigLoaded();

	const config = await core.filesystem.loadConfig();
	// Load local tasks and drafts in parallel
	const [tasks, drafts] = await Promise.all([core.filesystem.listTasks(), core.filesystem.listDrafts()]);

	const allIds: string[] = [];

	// Add local task and draft IDs first
	for (const t of tasks) {
		allIds.push(t.id);
	}
	for (const d of drafts) {
		allIds.push(d.id);
	}

	try {
		const backlogDir = DEFAULT_DIRECTORIES.BACKLOG;

		// Skip remote operations if disabled
		if (config?.remoteOperations === false) {
			if (process.env.DEBUG) {
				console.log("Remote operations disabled - generating ID from local tasks only");
			}
		} else {
			await core.gitOps.fetch();
		}

		const branches = await core.gitOps.listAllBranches();

		// Filter and normalize branch names - handle both local and remote branches
		const normalizedBranches = branches
			.flatMap((branch) => {
				// For remote branches like "origin/feature", extract just "feature"
				// But also try the full remote ref in case it's needed
				if (branch.startsWith("origin/")) {
					return [branch, branch.replace("origin/", "")];
				}
				return [branch];
			})
			// Remove duplicates and filter out HEAD
			.filter((branch, index, arr) => arr.indexOf(branch) === index && branch !== "HEAD" && !branch.includes("HEAD"));

		// Load files from all branches in parallel with better error handling
		const branchFilePromises = normalizedBranches.map(async (branch) => {
			try {
				const files = await core.gitOps.listFilesInTree(branch, `${backlogDir}/tasks`);
				return files
					.map((file) => {
						const match = file.match(/task-(\d+)/);
						return match ? `task-${match[1]}` : null;
					})
					.filter((id): id is string => id !== null);
			} catch (error) {
				// Silently ignore errors for individual branches (they might not exist or be accessible)
				if (process.env.DEBUG) {
					console.log(`Could not access branch ${branch}:`, error);
				}
				return [];
			}
		});

		const branchResults = await Promise.all(branchFilePromises);
		for (const branchIds of branchResults) {
			allIds.push(...branchIds);
		}
	} catch (error) {
		// Suppress errors for offline mode or other git issues
		if (process.env.DEBUG) {
			console.error("Could not fetch remote task IDs:", error);
		}
	}

	if (parent) {
		const prefix = parent.startsWith("task-") ? parent : `task-${parent}`;
		let max = 0;
		// Iterate over allIds (which now includes both local and remote)
		for (const id of allIds) {
			if (id.startsWith(`${prefix}.`)) {
				const rest = id.slice(prefix.length + 1);
				const num = Number.parseInt(rest.split(".")[0] || "0", 10);
				if (num > max) max = num;
			}
		}
		const nextSubIdNumber = max + 1;
		const padding = config?.zeroPaddedIds;

		if (padding && typeof padding === "number" && padding > 0) {
			// Pad sub-tasks to 2 digits. This supports up to 99 sub-tasks,
			// which is a reasonable limit and keeps IDs from getting too long.
			const paddedSubId = String(nextSubIdNumber).padStart(2, "0");
			return `${prefix}.${paddedSubId}`;
		}

		return `${prefix}.${nextSubIdNumber}`;
	}

	let max = 0;
	// Iterate over allIds (which now includes both local and remote)
	for (const id of allIds) {
		const match = id.match(/^task-(\d+)/);
		if (match) {
			const num = Number.parseInt(match[1] || "0", 10);
			if (num > max) max = num;
		}
	}
	const nextIdNumber = max + 1;
	const padding = config?.zeroPaddedIds;

	if (padding && typeof padding === "number" && padding > 0) {
		const paddedId = String(nextIdNumber).padStart(padding, "0");
		return `task-${paddedId}`;
	}

	return `task-${nextIdNumber}`;
}

function normalizeDependencies(dependencies: unknown): string[] {
	if (!dependencies) return [];

	// Handle multiple flags: --dep task-1 --dep task-2
	if (Array.isArray(dependencies)) {
		return dependencies
			.flatMap((dep) =>
				String(dep)
					.split(",")
					.map((d) => d.trim()),
			)
			.filter(Boolean)
			.map((dep) => (dep.startsWith("task-") ? dep : `task-${dep}`));
	}

	// Handle comma-separated: --dep task-1,task-2,task-3
	return String(dependencies)
		.split(",")
		.map((dep) => dep.trim())
		.filter(Boolean)
		.map((dep) => (dep.startsWith("task-") ? dep : `task-${dep}`));
}

async function validateDependencies(
	dependencies: string[],
	core: Core,
): Promise<{ valid: string[]; invalid: string[] }> {
	const valid: string[] = [];
	const invalid: string[] = [];

	if (dependencies.length === 0) {
		return { valid, invalid };
	}

	// Load both tasks and drafts to validate dependencies
	const [tasks, drafts] = await Promise.all([core.filesystem.listTasks(), core.filesystem.listDrafts()]);

	const allTaskIds = new Set([...tasks.map((t) => t.id), ...drafts.map((d) => d.id)]);

	for (const dep of dependencies) {
		if (allTaskIds.has(dep)) {
			valid.push(dep);
		} else {
			invalid.push(dep);
		}
	}

	return { valid, invalid };
}

function buildTaskFromOptions(id: string, title: string, options: Record<string, unknown>): Task {
	const parentInput = options.parent ? String(options.parent) : undefined;
	const normalizedParent = parentInput
		? parentInput.startsWith("task-")
			? parentInput
			: `task-${parentInput}`
		: undefined;

	const createdDate = new Date().toISOString().split("T")[0] || new Date().toISOString().slice(0, 10);

	// Handle dependencies - they will be validated separately
	const dependencies = normalizeDependencies(options.dependsOn || options.dep);

	// Validate priority option
	const priority = options.priority ? String(options.priority).toLowerCase() : undefined;
	const validPriorities = ["high", "medium", "low"];
	const validatedPriority =
		priority && validPriorities.includes(priority) ? (priority as "high" | "medium" | "low") : undefined;

	return {
		id,
		title,
		status: options.status ? String(options.status) : "",
		assignee: options.assignee ? [String(options.assignee)] : [],
		createdDate,
		labels: options.labels
			? String(options.labels)
					.split(",")
					.map((l: string) => l.trim())
					.filter(Boolean)
			: [],
		dependencies,
		body: options.description || options.desc ? String(options.description || options.desc) : "",
		...(normalizedParent && { parentTaskId: normalizedParent }),
		...(validatedPriority && { priority: validatedPriority }),
	};
}

const taskCmd = program.command("task").aliases(["tasks"]);

taskCmd
	.command("create <title>")
	.option("-d, --description <text>")
	.option("--desc <text>", "alias for --description")
	.option("-a, --assignee <assignee>")
	.option("-s, --status <status>")
	.option("-l, --labels <labels>")
	.option("--priority <priority>", "set task priority (high, medium, low)")
	.option("--ac <criteria>", "add acceptance criteria (comma-separated or use multiple times)")
	.option("--acceptance-criteria <criteria>", "add acceptance criteria (comma-separated or use multiple times)")
	.option("--plan <text>", "add implementation plan")
	.option("--notes <text>", "add implementation notes")
	.option("--draft")
	.option("-p, --parent <taskId>", "specify parent task ID")
	.option(
		"--depends-on <taskIds>",
		"specify task dependencies (comma-separated or use multiple times)",
		(value, previous) => {
			const soFar = Array.isArray(previous) ? previous : previous ? [previous] : [];
			return [...soFar, value];
		},
	)
	.option("--dep <taskIds>", "specify task dependencies (shortcut for --depends-on)", (value, previous) => {
		const soFar = Array.isArray(previous) ? previous : previous ? [previous] : [];
		return [...soFar, value];
	})
	.action(async (title: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		await core.ensureConfigLoaded();
		const id = await generateNextId(core, options.parent);
		const task = buildTaskFromOptions(id, title, options);

		// Validate dependencies if provided
		if (task.dependencies.length > 0) {
			const { valid, invalid } = await validateDependencies(task.dependencies, core);
			if (invalid.length > 0) {
				console.error(`Error: The following dependencies do not exist: ${invalid.join(", ")}`);
				console.error("Please create these tasks first or check the task IDs.");
				process.exitCode = 1;
				return;
			}
			task.dependencies = valid;
		}

		// Handle acceptance criteria (support both --ac and --acceptance-criteria)
		const acceptanceCriteria = options.ac || options.acceptanceCriteria;
		if (acceptanceCriteria) {
			const { updateTaskAcceptanceCriteria } = await import("./markdown/serializer.ts");
			const criteria = Array.isArray(acceptanceCriteria)
				? acceptanceCriteria.flatMap((c: string) => c.split(",").map((item: string) => item.trim()))
				: String(acceptanceCriteria)
						.split(",")
						.map((item: string) => item.trim());
			task.body = updateTaskAcceptanceCriteria(task.body, criteria.filter(Boolean));
		}

		// Handle implementation plan
		if (options.plan) {
			const { updateTaskImplementationPlan } = await import("./markdown/serializer.ts");
			task.body = updateTaskImplementationPlan(task.body, String(options.plan));
		}

		// Handle implementation notes
		if (options.notes) {
			const { updateTaskImplementationNotes } = await import("./markdown/serializer.ts");
			task.body = updateTaskImplementationNotes(task.body, String(options.notes));
		}

		if (options.draft) {
			const filepath = await core.createDraft(task);
			console.log(`Created draft ${id}`);
			console.log(`File: ${filepath}`);
		} else {
			const filepath = await core.createTask(task);
			console.log(`Created task ${id}`);
			console.log(`File: ${filepath}`);
		}
	});

taskCmd
	.command("list")
	.description("list tasks grouped by status")
	.option("-s, --status <status>", "filter tasks by status (case-insensitive)")
	.option("-a, --assignee <assignee>", "filter tasks by assignee")
	.option("-p, --parent <taskId>", "filter tasks by parent task ID")
	.option("--priority <priority>", "filter tasks by priority (high, medium, low)")
	.option("--sort <field>", "sort tasks by field (priority, id)")
	.option("--plain", "use plain text output instead of interactive UI")
	.action(async (options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const tasks = await core.filesystem.listTasks();
		const config = await core.filesystem.loadConfig();

		let filtered = tasks;
		if (options.status) {
			const statusLower = options.status.toLowerCase();
			filtered = filtered.filter((t) => t.status.toLowerCase() === statusLower);
		}
		if (options.assignee) {
			filtered = filtered.filter((t) => t.assignee.includes(options.assignee));
		}
		if (options.parent) {
			// Normalize parent task ID
			const parentId = options.parent.startsWith("task-") ? options.parent : `task-${options.parent}`;

			// Validate parent task exists
			const parentTask = await core.filesystem.loadTask(parentId);
			if (!parentTask) {
				console.error(`Parent task ${parentId} not found.`);
				process.exitCode = 1;
				return;
			}

			// Filter tasks by parent ID
			filtered = filtered.filter((t) => t.parentTaskId === parentId);
		}
		if (options.priority) {
			const priorityLower = options.priority.toLowerCase();
			const validPriorities = ["high", "medium", "low"];
			if (!validPriorities.includes(priorityLower)) {
				console.error(`Invalid priority: ${options.priority}. Valid values are: high, medium, low`);
				process.exitCode = 1;
				return;
			}
			filtered = filtered.filter((t) => t.priority?.toLowerCase() === priorityLower);
		}

		// Apply sorting - default to priority sorting
		let sortedTasks = filtered;
		if (options.sort) {
			const validSortFields = ["priority", "id"];
			const sortField = options.sort.toLowerCase();
			if (!validSortFields.includes(sortField)) {
				console.error(`Invalid sort field: ${options.sort}. Valid values are: priority, id`);
				process.exitCode = 1;
				return;
			}
			sortedTasks = sortTasks(filtered, sortField);
		} else {
			// Default to priority sorting
			sortedTasks = sortTasks(filtered, "priority");
		}
		filtered = sortedTasks;

		if (filtered.length === 0) {
			if (options.parent) {
				const parentId = options.parent.startsWith("task-") ? options.parent : `task-${options.parent}`;
				console.log(`No child tasks found for parent task ${parentId}.`);
			} else {
				console.log("No tasks found.");
			}
			return;
		}

		// Plain text output
		// Workaround for bun compile issue with commander options
		const isPlainFlag = options.plain || process.argv.includes("--plain");
		if (isPlainFlag) {
			// If sorting by priority, do global sorting instead of status-grouped sorting
			if (options.sort && options.sort.toLowerCase() === "priority") {
				const sortedTasks = sortTasks(filtered, "priority");
				console.log("Tasks (sorted by priority):");
				for (const t of sortedTasks) {
					const priorityIndicator = t.priority ? `[${t.priority.toUpperCase()}] ` : "";
					const statusIndicator = t.status ? ` (${t.status})` : "";
					console.log(`  ${priorityIndicator}${t.id} - ${t.title}${statusIndicator}`);
				}
				return;
			}

			const groups = new Map<string, Task[]>();
			for (const task of filtered) {
				const status = task.status || "";
				const list = groups.get(status) || [];
				list.push(task);
				groups.set(status, list);
			}

			const statuses = config?.statuses || [];
			const ordered = [
				...statuses.filter((s) => groups.has(s)),
				...Array.from(groups.keys()).filter((s) => !statuses.includes(s)),
			];

			for (const status of ordered) {
				const list = groups.get(status);
				if (!list) continue;

				// Sort tasks within each status group if a sort field was specified
				let sortedList = list;
				if (options.sort) {
					sortedList = sortTasks(list, options.sort.toLowerCase());
				}

				console.log(`${status || "No Status"}:`);
				for (const t of sortedList) {
					const priorityIndicator = t.priority ? `[${t.priority.toUpperCase()}] ` : "";
					console.log(`  ${priorityIndicator}${t.id} - ${t.title}`);
				}
				console.log();
			}
			return;
		}

		// Interactive UI - use unified view for Tab switching support
		if (filtered.length > 0) {
			// Use the first task as the initial selection
			const firstTask = filtered[0];
			if (!firstTask) {
				console.log("No tasks found.");
				return;
			}

			// Build filter description for the footer and title
			let filterDescription = "";
			let title = "Tasks";

			const filters = [];
			if (options.status) filters.push(`Status: ${options.status}`);
			if (options.assignee) filters.push(`Assignee: ${options.assignee}`);
			if (options.parent) {
				const parentId = options.parent.startsWith("task-") ? options.parent : `task-${options.parent}`;
				filters.push(`Parent: ${parentId}`);
			}
			if (options.priority) filters.push(`Priority: ${options.priority}`);
			if (options.sort) filters.push(`Sort: ${options.sort}`);

			if (filters.length > 0) {
				filterDescription = filters.join(", ");
				title = `Tasks (${filters.join(" • ")})`;
			}

			// Use unified view with Tab switching support
			const { runUnifiedView } = await import("./ui/unified-view.ts");
			await runUnifiedView({
				core,
				initialView: "task-list",
				selectedTask: firstTask,
				tasks: filtered,
				filter: {
					status: options.status,
					assignee: options.assignee,
					priority: options.priority,
					sort: options.sort,
					title,
					filterDescription,
				},
			});
		}
	});

taskCmd
	.command("edit <taskId>")
	.description("edit an existing task")
	.option("-t, --title <title>")
	.option("-d, --description <text>")
	.option("--desc <text>", "alias for --description")
	.option("-a, --assignee <assignee>")
	.option("-s, --status <status>")
	.option("-l, --label <labels>")
	.option("--priority <priority>", "set task priority (high, medium, low)")
	.option("--add-label <label>")
	.option("--remove-label <label>")
	.option("--ac <criteria>", "set acceptance criteria (comma-separated or use multiple times)")
	.option("--acceptance-criteria <criteria>", "set acceptance criteria (comma-separated or use multiple times)")
	.option("--plan <text>", "set implementation plan")
	.option("--notes <text>", "add implementation notes")
	.option(
		"--depends-on <taskIds>",
		"set task dependencies (comma-separated or use multiple times)",
		(value, previous) => {
			const soFar = Array.isArray(previous) ? previous : previous ? [previous] : [];
			return [...soFar, value];
		},
	)
	.option("--dep <taskIds>", "set task dependencies (shortcut for --depends-on)", (value, previous) => {
		const soFar = Array.isArray(previous) ? previous : previous ? [previous] : [];
		return [...soFar, value];
	})
	.action(async (taskId: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const task = await core.filesystem.loadTask(taskId);

		if (!task) {
			console.error(`Task ${taskId} not found.`);
			return;
		}

		if (options.title) {
			task.title = String(options.title);
		}
		if (options.description || options.desc) {
			const { updateTaskDescription } = await import("./markdown/serializer.ts");
			task.body = updateTaskDescription(task.body, String(options.description || options.desc));
		}
		if (typeof options.assignee !== "undefined") {
			task.assignee = [String(options.assignee)];
		}
		if (options.status) {
			task.status = String(options.status);
		}

		if (options.priority) {
			const priority = String(options.priority).toLowerCase();
			const validPriorities = ["high", "medium", "low"];
			if (validPriorities.includes(priority)) {
				task.priority = priority as "high" | "medium" | "low";
			} else {
				console.error(`Invalid priority: ${priority}. Valid values are: high, medium, low`);
				return;
			}
		}

		const labels = [...task.labels];
		if (options.label) {
			const newLabels = String(options.label)
				.split(",")
				.map((l: string) => l.trim())
				.filter(Boolean);
			labels.splice(0, labels.length, ...newLabels);
		}
		if (options.addLabel) {
			const adds = Array.isArray(options.addLabel) ? options.addLabel : [options.addLabel];
			for (const l of adds) {
				const trimmed = String(l).trim();
				if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
			}
		}
		if (options.removeLabel) {
			const removes = Array.isArray(options.removeLabel) ? options.removeLabel : [options.removeLabel];
			for (const l of removes) {
				const trimmed = String(l).trim();
				const idx = labels.indexOf(trimmed);
				if (idx !== -1) labels.splice(idx, 1);
			}
		}
		task.labels = labels;

		// Handle dependencies
		if (options.dependsOn || options.dep) {
			const dependencies = normalizeDependencies(options.dependsOn || options.dep);
			const { valid, invalid } = await validateDependencies(dependencies, core);
			if (invalid.length > 0) {
				console.error(`Error: The following dependencies do not exist: ${invalid.join(", ")}`);
				console.error("Please create these tasks first or check the task IDs.");
				process.exitCode = 1;
				return;
			}
			task.dependencies = valid;
		}

		// Handle acceptance criteria (support both --ac and --acceptance-criteria)
		const acceptanceCriteria = options.ac || options.acceptanceCriteria;
		if (acceptanceCriteria) {
			const { updateTaskAcceptanceCriteria } = await import("./markdown/serializer.ts");
			const criteria = Array.isArray(acceptanceCriteria)
				? acceptanceCriteria.flatMap((c: string) => c.split(",").map((item: string) => item.trim()))
				: String(acceptanceCriteria)
						.split(",")
						.map((item: string) => item.trim());
			task.body = updateTaskAcceptanceCriteria(task.body, criteria.filter(Boolean));
		}

		// Handle implementation plan
		if (options.plan) {
			const { updateTaskImplementationPlan } = await import("./markdown/serializer.ts");
			task.body = updateTaskImplementationPlan(task.body, String(options.plan));
		}

		// Handle implementation notes
		if (options.notes) {
			const { updateTaskImplementationNotes } = await import("./markdown/serializer.ts");
			task.body = updateTaskImplementationNotes(task.body, String(options.notes));
		}

		await core.updateTask(task);
		console.log(`Updated task ${task.id}`);
	});

taskCmd
	.command("view <taskId>")
	.description("display task details")
	.option("--plain", "use plain text output instead of interactive UI")
	.action(async (taskId: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const filePath = await getTaskPath(taskId, core);

		if (!filePath) {
			console.error(`Task ${taskId} not found.`);
			return;
		}
		const content = await Bun.file(filePath).text();
		const task = await core.filesystem.loadTask(taskId);

		if (!task) {
			console.error(`Task ${taskId} not found.`);
			return;
		}

		// Plain text output for AI agents
		if (options && (("plain" in options && options.plain) || process.argv.includes("--plain"))) {
			console.log(formatTaskPlainText(task, content, filePath));
			return;
		}

		// Use enhanced task viewer with detail focus
		await viewTaskEnhanced(task, content, { startWithDetailFocus: true });
	});

taskCmd
	.command("archive <taskId>")
	.description("archive a task")
	.action(async (taskId: string) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const success = await core.archiveTask(taskId);
		if (success) {
			console.log(`Archived task ${taskId}`);
		} else {
			console.error(`Task ${taskId} not found.`);
		}
	});

taskCmd
	.command("demote <taskId>")
	.description("move task back to drafts")
	.action(async (taskId: string) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const success = await core.demoteTask(taskId);
		if (success) {
			console.log(`Demoted task ${taskId}`);
		} else {
			console.error(`Task ${taskId} not found.`);
		}
	});

taskCmd
	.argument("[taskId]")
	.option("--plain", "use plain text output")
	.action(async (taskId: string | undefined, options: { plain?: boolean }) => {
		const cwd = process.cwd();
		const core = new Core(cwd);

		// Don't handle commands that should be handled by specific command handlers
		const reservedCommands = ["create", "list", "edit", "view", "archive", "demote"];
		if (taskId && reservedCommands.includes(taskId)) {
			console.error(`Unknown command: ${taskId}`);
			taskCmd.help();
			return;
		}

		// Handle single task view only
		if (!taskId) {
			taskCmd.help();
			return;
		}

		const filePath = await getTaskPath(taskId, core);
		if (!filePath) {
			console.error(`Task ${taskId} not found.`);
			return;
		}
		const content = await Bun.file(filePath).text();
		const task = await core.filesystem.loadTask(taskId);

		if (!task) {
			console.error(`Task ${taskId} not found.`);
			return;
		}

		// Plain text output for AI agents
		if (options && (options.plain || process.argv.includes("--plain"))) {
			console.log(formatTaskPlainText(task, content, filePath));
			return;
		}

		// Use unified view with detail focus and Tab switching support
		const allTasks = await core.filesystem.listTasks();
		const { runUnifiedView } = await import("./ui/unified-view.ts");
		await runUnifiedView({
			core,
			initialView: "task-detail",
			selectedTask: task,
			tasks: allTasks,
		});
	});

const draftCmd = program.command("draft");

draftCmd
	.command("list")
	.description("list all drafts")
	.option("--sort <field>", "sort drafts by field (priority, id)")
	.option("--plain", "use plain text output")
	.action(async (options: { plain?: boolean; sort?: string }) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		await core.ensureConfigLoaded();
		const drafts = await core.filesystem.listDrafts();

		if (!drafts || drafts.length === 0) {
			console.log("No drafts found.");
			return;
		}

		// Apply sorting - default to priority sorting like the web UI
		const { sortTasks } = await import("./utils/task-sorting.ts");
		let sortedDrafts = drafts;

		if (options.sort) {
			const validSortFields = ["priority", "id"];
			const sortField = options.sort.toLowerCase();
			if (!validSortFields.includes(sortField)) {
				console.error(`Invalid sort field: ${options.sort}. Valid values are: priority, id`);
				process.exitCode = 1;
				return;
			}
			sortedDrafts = sortTasks(drafts, sortField);
		} else {
			// Default to priority sorting to match web UI behavior
			sortedDrafts = sortTasks(drafts, "priority");
		}

		if (options.plain || process.argv.includes("--plain")) {
			// Plain text output for AI agents
			console.log("Drafts:");
			for (const draft of sortedDrafts) {
				const priorityIndicator = draft.priority ? `[${draft.priority.toUpperCase()}] ` : "";
				console.log(`  ${priorityIndicator}${draft.id} - ${draft.title}`);
			}
		} else {
			// Interactive UI - use unified view with draft support
			const firstDraft = sortedDrafts[0];
			if (!firstDraft) return;

			const { runUnifiedView } = await import("./ui/unified-view.ts");
			await runUnifiedView({
				core,
				initialView: "task-list",
				selectedTask: firstDraft,
				tasks: sortedDrafts,
				filter: {
					filterDescription: "All Drafts",
				},
				title: "Drafts",
			});
		}
	});

draftCmd
	.command("create <title>")
	.option("-d, --description <text>")
	.option("--desc <text>", "alias for --description")
	.option("-a, --assignee <assignee>")
	.option("-s, --status <status>")
	.option("-l, --labels <labels>")
	.action(async (title: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		await core.ensureConfigLoaded();
		const id = await generateNextId(core);
		const task = buildTaskFromOptions(id, title, options);
		const filepath = await core.createDraft(task);
		console.log(`Created draft ${id}`);
		console.log(`File: ${filepath}`);
	});

draftCmd
	.command("archive <taskId>")
	.description("archive a draft")
	.action(async (taskId: string) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const success = await core.archiveDraft(taskId);
		if (success) {
			console.log(`Archived draft ${taskId}`);
		} else {
			console.error(`Draft ${taskId} not found.`);
		}
	});

draftCmd
	.command("promote <taskId>")
	.description("promote draft to task")
	.action(async (taskId: string) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const success = await core.promoteDraft(taskId);
		if (success) {
			console.log(`Promoted draft ${taskId}`);
		} else {
			console.error(`Draft ${taskId} not found.`);
		}
	});

draftCmd
	.command("view <taskId>")
	.description("display draft details")
	.option("--plain", "use plain text output instead of interactive UI")
	.action(async (taskId: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const { getDraftPath } = await import("./utils/task-path.ts");
		const filePath = await getDraftPath(taskId, core);

		if (!filePath) {
			console.error(`Draft ${taskId} not found.`);
			return;
		}
		const content = await Bun.file(filePath).text();
		const draft = await core.filesystem.loadDraft(taskId);

		if (!draft) {
			console.error(`Draft ${taskId} not found.`);
			return;
		}

		// Plain text output for AI agents
		if (options && (("plain" in options && options.plain) || process.argv.includes("--plain"))) {
			console.log(formatTaskPlainText(draft, content, filePath));
			return;
		}

		// Use enhanced task viewer with detail focus
		await viewTaskEnhanced(draft, content, { startWithDetailFocus: true });
	});

draftCmd
	.argument("[taskId]")
	.option("--plain", "use plain text output")
	.action(async (taskId: string | undefined, options: { plain?: boolean }) => {
		if (!taskId) {
			draftCmd.help();
			return;
		}

		const cwd = process.cwd();
		const core = new Core(cwd);
		const { getDraftPath } = await import("./utils/task-path.ts");
		const filePath = await getDraftPath(taskId, core);

		if (!filePath) {
			console.error(`Draft ${taskId} not found.`);
			return;
		}
		const content = await Bun.file(filePath).text();
		const draft = await core.filesystem.loadDraft(taskId);

		if (!draft) {
			console.error(`Draft ${taskId} not found.`);
			return;
		}

		// Plain text output for AI agents
		if (options && (options.plain || process.argv.includes("--plain"))) {
			console.log(formatTaskPlainText(draft, content, filePath));
			return;
		}

		// Use enhanced task viewer with detail focus
		await viewTaskEnhanced(draft, content, { startWithDetailFocus: true });
	});

const boardCmd = program.command("board");

function addBoardOptions(cmd: Command) {
	return cmd
		.option("-l, --layout <layout>", "board layout (horizontal|vertical)", "horizontal")
		.option("--vertical", "use vertical layout (shortcut for --layout vertical)");
}

// TaskWithMetadata and resolveTaskConflict are now imported from remote-tasks.ts

async function handleBoardView(options: { layout?: string; vertical?: boolean }) {
	const cwd = process.cwd();
	const core = new Core(cwd);
	const config = await core.filesystem.loadConfig();
	const statuses = config?.statuses || [];
	const resolutionStrategy = config?.taskResolutionStrategy || "most_progressed";

	// Load tasks with loading screen for better user experience
	const allTasks = await (async () => {
		const loadingScreen = await createLoadingScreen("Loading board");

		try {
			// Load local and remote tasks in parallel
			const { getTaskLoadingMessage } = await import("./core/remote-tasks.ts");
			loadingScreen?.update(getTaskLoadingMessage(config));
			const [localTasks, remoteTasks] = await Promise.all([
				core.listTasksWithMetadata(),
				loadRemoteTasks(core.gitOps, core.filesystem, config),
			]);

			// Create map with local tasks
			const tasksById = new Map<string, Task>(localTasks.map((t) => [t.id, { ...t, source: "local" }]));

			// Merge remote tasks with local tasks
			for (const remoteTask of remoteTasks) {
				const existing = tasksById.get(remoteTask.id);
				if (!existing) {
					tasksById.set(remoteTask.id, remoteTask);
				} else {
					const resolved = resolveTaskConflict(existing, remoteTask, statuses, resolutionStrategy);
					tasksById.set(remoteTask.id, resolved);
				}
			}

			// Get the latest directory location of each task across all branches
			// Use optimized version that only checks the tasks we have
			loadingScreen?.update("Resolving task states across branches...");
			const tasks = Array.from(tasksById.values());
			const taskIds = tasks.map((t) => t.id);
			const latestTaskDirectories = await getLatestTaskStatesForIds(core.gitOps, core.filesystem, taskIds, (msg) => {
				loadingScreen?.update(msg);
			});

			// Filter tasks based on their latest directory location
			// Only show tasks whose latest directory type is "task" (not draft or archived)
			loadingScreen?.update("Filtering active tasks...");
			const filteredTasks = filterTasksByLatestState(tasks, latestTaskDirectories);

			loadingScreen?.close();
			return filteredTasks;
		} catch (error) {
			loadingScreen?.close();
			throw error;
		}
	})();

	if (allTasks.length === 0) {
		console.log("No tasks found.");
		return;
	}

	const _layout = options.vertical ? "vertical" : (options.layout as "horizontal" | "vertical") || "horizontal";
	const _maxColumnWidth = config?.maxColumnWidth || 20; // Default for terminal display

	// Use unified view for Tab switching support
	const { runUnifiedView } = await import("./ui/unified-view.ts");
	await runUnifiedView({
		core,
		initialView: "kanban",
		tasks: allTasks.map((t) => ({ ...t, status: t.status || "" })), // Ensure tasks have status
		// Pass the already-loaded kanban data to avoid duplicate loading
		preloadedKanbanData: {
			tasks: allTasks,
			statuses,
		},
	});
}

addBoardOptions(boardCmd).description("display tasks in a Kanban board").action(handleBoardView);

addBoardOptions(boardCmd.command("view").description("display tasks in a Kanban board")).action(handleBoardView);

boardCmd
	.command("export [filename]")
	.description("export kanban board to markdown file")
	.option("--force", "overwrite existing file without confirmation")
	.option("--readme", "export to README.md with markers")
	.option("--export-version <version>", "version to include in the export")
	.action(async (filename, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const config = await core.filesystem.loadConfig();
		const statuses = config?.statuses || [];
		const resolutionStrategy = config?.taskResolutionStrategy || "most_progressed";

		// Load tasks with progress tracking
		const loadingScreen = await createLoadingScreen("Loading tasks for export");

		try {
			// Load local tasks
			loadingScreen?.update("Loading local tasks...");
			const localTasks = await core.listTasksWithMetadata();
			const tasksById = new Map<string, TaskWithMetadata>(
				localTasks.map((t) => [t.id, { ...t, source: "local" } as TaskWithMetadata]),
			);
			loadingScreen?.update(`Found ${localTasks.length} local tasks`);

			// Load remote tasks in parallel
			loadingScreen?.update("Loading remote tasks...");
			const remoteTasks = await loadRemoteTasks(core.gitOps, core.filesystem, config, (msg) =>
				loadingScreen?.update(msg),
			);

			// Merge remote tasks with local tasks
			loadingScreen?.update("Merging tasks...");
			for (const remoteTask of remoteTasks) {
				const existing = tasksById.get(remoteTask.id);
				if (!existing) {
					tasksById.set(remoteTask.id, remoteTask);
				} else {
					const resolved = resolveTaskConflict(existing, remoteTask, statuses, resolutionStrategy);
					tasksById.set(remoteTask.id, resolved);
				}
			}

			// Get the latest state of each task across all branches
			loadingScreen?.update("Checking task states across branches...");
			const tasks = Array.from(tasksById.values());
			const taskIds = tasks.map((t) => t.id);
			const latestTaskDirectories = await getLatestTaskStatesForIds(core.gitOps, core.filesystem, taskIds, (msg) =>
				loadingScreen?.update(msg),
			);

			// Filter tasks based on their latest directory location
			// Only show tasks whose latest directory type is "task" (not draft or archived)
			const finalTasks = filterTasksByLatestState(tasks, latestTaskDirectories);

			loadingScreen?.update(`Total tasks: ${finalTasks.length}`);

			// Close loading screen before export
			loadingScreen?.close();

			// Get project name from config or use directory name
			const { basename } = await import("node:path");
			const projectName = config?.projectName || basename(cwd);

			if (options.readme) {
				// Use version from option if provided, otherwise use the CLI version
				const exportVersion = options.exportVersion || version;
				await updateReadmeWithBoard(finalTasks, statuses, projectName, exportVersion);
				console.log("Updated README.md with Kanban board.");
			} else {
				// Use filename argument or default to Backlog.md
				const outputFile = filename || "Backlog.md";
				const outputPath = join(cwd, outputFile as string);

				// Check if file exists and handle overwrite confirmation
				const fileExists = await Bun.file(outputPath).exists();
				if (fileExists && !options.force) {
					const rl = createInterface({ input });
					try {
						const answer = await rl.question(`File "${outputPath}" already exists. Overwrite? (y/N): `);
						if (!answer.toLowerCase().startsWith("y")) {
							console.log("Export cancelled.");
							return;
						}
					} finally {
						rl.close();
					}
				}

				await exportKanbanBoardToFile(finalTasks, statuses, outputPath, projectName, options.force || !fileExists);
				console.log(`Exported board to ${outputPath}`);
			}
		} catch (error) {
			loadingScreen?.close();
			throw error;
		}
	});

const docCmd = program.command("doc");

docCmd
	.command("create <title>")
	.option("-p, --path <path>")
	.option("-t, --type <type>")
	.action(async (title: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const id = await generateNextDocId(core);
		const document: DocType = {
			id,
			title: title as string,
			type: (options.type || "other") as DocType["type"],
			createdDate: new Date().toISOString().split("T")[0] || new Date().toISOString().slice(0, 10),
			body: "",
		};
		await core.createDocument(document, undefined, options.path || "");
		console.log(`Created document ${id}`);
	});

docCmd
	.command("list")
	.option("--plain", "use plain text output instead of interactive UI")
	.action(async (options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const docs = await core.filesystem.listDocuments();
		if (docs.length === 0) {
			console.log("No docs found.");
			return;
		}

		// Plain text output
		// Workaround for bun compile issue with commander options
		const isPlainFlag = options.plain || process.argv.includes("--plain");
		if (isPlainFlag) {
			for (const d of docs) {
				console.log(`${d.id} - ${d.title}`);
			}
			return;
		}

		// Interactive UI
		const selected = await genericSelectList("Select a document", docs);
		if (selected) {
			// Show document details
			const files = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: core.filesystem.docsDir }));
			const docFile = files.find((f) => f.startsWith(`${selected.id} -`) || f === `${selected.id}.md`);
			if (docFile) {
				const filePath = join(core.filesystem.docsDir, docFile);
				const content = await Bun.file(filePath).text();
				await scrollableViewer(content);
			}
		}
	});

// Document view command
docCmd
	.command("view <docId>")
	.description("view a document")
	.action(async (docId: string) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const files = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: core.filesystem.docsDir }));
		const normalizedId = docId.startsWith("doc-") ? docId : `doc-${docId}`;
		const docFile = files.find((f) => f.startsWith(`${normalizedId} -`) || f === `${normalizedId}.md`);

		if (!docFile) {
			console.error(`Document ${docId} not found.`);
			return;
		}

		const filePath = join(core.filesystem.docsDir, docFile);
		const content = await Bun.file(filePath).text();

		// Use scrollableViewer which falls back to console.log if blessed is not available
		await scrollableViewer(content);
	});

const decisionCmd = program.command("decision");

decisionCmd
	.command("create <title>")
	.option("-s, --status <status>")
	.action(async (title: string, options) => {
		const cwd = process.cwd();
		const core = new Core(cwd);
		const id = await generateNextDecisionId(core);
		const decision: Decision = {
			id,
			title: title as string,
			date: new Date().toISOString().split("T")[0] || new Date().toISOString().slice(0, 10),
			status: (options.status || "proposed") as Decision["status"],
			context: "",
			decision: "",
			consequences: "",
		};
		await core.createDecision(decision);
		console.log(`Created decision ${id}`);
	});

// Agents command group
const agentsCmd = program.command("agents");

agentsCmd
	.description("manage agent instruction files")
	.option(
		"--update-instructions",
		"update agent instruction files (.cursorrules, CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md)",
	)
	.action(async (options) => {
		if (!options.updateInstructions) {
			agentsCmd.help();
			return;
		}
		try {
			const cwd = process.cwd();
			const core = new Core(cwd);

			// Check if backlog project is initialized
			const config = await core.filesystem.loadConfig();
			if (!config) {
				console.error("No backlog project found. Initialize one first with: backlog init");
				process.exit(1);
			}

			const agentOptions = [
				".cursorrules",
				"CLAUDE.md",
				"AGENTS.md",
				"GEMINI.md",
				".github/copilot-instructions.md",
			] as const;

			const { files: selected } = await prompts({
				type: "multiselect",
				name: "files",
				message: "Select agent instruction files to update",
				choices: agentOptions.map((name) => ({
					title: name === ".github/copilot-instructions.md" ? "Copilot" : name,
					value: name,
				})),
				hint: "Space to select, Enter to confirm",
				instructions: false,
			});

			const files: AgentInstructionFile[] = (selected ?? []) as AgentInstructionFile[];

			if (files.length > 0) {
				// Get autoCommit setting from config
				const config = await core.filesystem.loadConfig();
				const shouldAutoCommit = config?.autoCommit ?? false;
				await addAgentInstructions(cwd, core.gitOps, files, shouldAutoCommit);
				console.log(`Updated ${files.length} agent instruction file(s): ${files.join(", ")}`);
			} else {
				console.log("No files selected for update.");
			}
		} catch (err) {
			console.error("Failed to update agent instructions", err);
			process.exitCode = 1;
		}
	});

// Config command group
const configCmd = program.command("config");

configCmd
	.command("get <key>")
	.description("get a configuration value")
	.action(async (key: string) => {
		try {
			const cwd = process.cwd();
			const core = new Core(cwd);
			const config = await core.filesystem.loadConfig();

			if (!config) {
				console.error("No backlog project found. Initialize one first with: backlog init");
				process.exit(1);
			}

			// Handle specific config keys
			switch (key) {
				case "defaultEditor":
					if (config.defaultEditor) {
						console.log(config.defaultEditor);
					} else {
						console.log("defaultEditor is not set");
						process.exit(1);
					}
					break;
				case "projectName":
					console.log(config.projectName);
					break;
				case "defaultStatus":
					console.log(config.defaultStatus || "");
					break;
				case "statuses":
					console.log(config.statuses.join(", "));
					break;
				case "labels":
					console.log(config.labels.join(", "));
					break;
				case "milestones":
					console.log(config.milestones.join(", "));
					break;
				case "dateFormat":
					console.log(config.dateFormat);
					break;
				case "maxColumnWidth":
					console.log(config.maxColumnWidth?.toString() || "");
					break;
				case "defaultPort":
					console.log(config.defaultPort?.toString() || "");
					break;
				case "autoOpenBrowser":
					console.log(config.autoOpenBrowser?.toString() || "");
					break;
				case "remoteOperations":
					console.log(config.remoteOperations?.toString() || "");
					break;
				case "autoCommit":
					console.log(config.autoCommit?.toString() || "");
					break;
				case "zeroPaddedIds":
					console.log(config.zeroPaddedIds?.toString() || "(disabled)");
					break;
				default:
					console.error(`Unknown config key: ${key}`);
					console.error(
						"Available keys: defaultEditor, projectName, defaultStatus, statuses, labels, milestones, dateFormat, maxColumnWidth, defaultPort, autoOpenBrowser, remoteOperations, autoCommit, zeroPaddedIds",
					);
					process.exit(1);
			}
		} catch (err) {
			console.error("Failed to get config value", err);
			process.exitCode = 1;
		}
	});

configCmd
	.command("set <key> <value>")
	.description("set a configuration value")
	.action(async (key: string, value: string) => {
		try {
			const cwd = process.cwd();
			const core = new Core(cwd);
			const config = await core.filesystem.loadConfig();

			if (!config) {
				console.error("No backlog project found. Initialize one first with: backlog init");
				process.exit(1);
			}

			// Handle specific config keys
			switch (key) {
				case "defaultEditor": {
					// Validate that the editor command exists
					const { isEditorAvailable } = await import("./utils/editor.ts");
					const isAvailable = await isEditorAvailable(value);
					if (!isAvailable) {
						console.error(`Editor command not found: ${value}`);
						console.error("Please ensure the editor is installed and available in your PATH");
						process.exit(1);
					}
					config.defaultEditor = value;
					break;
				}
				case "projectName":
					config.projectName = value;
					break;
				case "defaultStatus":
					config.defaultStatus = value;
					break;
				case "dateFormat":
					config.dateFormat = value;
					break;
				case "maxColumnWidth": {
					const width = Number.parseInt(value, 10);
					if (Number.isNaN(width) || width <= 0) {
						console.error("maxColumnWidth must be a positive number");
						process.exit(1);
					}
					config.maxColumnWidth = width;
					break;
				}
				case "autoOpenBrowser": {
					const boolValue = value.toLowerCase();
					if (boolValue === "true" || boolValue === "1" || boolValue === "yes") {
						config.autoOpenBrowser = true;
					} else if (boolValue === "false" || boolValue === "0" || boolValue === "no") {
						config.autoOpenBrowser = false;
					} else {
						console.error("autoOpenBrowser must be true or false");
						process.exit(1);
					}
					break;
				}
				case "defaultPort": {
					const port = Number.parseInt(value, 10);
					if (Number.isNaN(port) || port < 1 || port > 65535) {
						console.error("defaultPort must be a valid port number (1-65535)");
						process.exit(1);
					}
					config.defaultPort = port;
					break;
				}
				case "remoteOperations": {
					const boolValue = value.toLowerCase();
					if (boolValue === "true" || boolValue === "1" || boolValue === "yes") {
						config.remoteOperations = true;
					} else if (boolValue === "false" || boolValue === "0" || boolValue === "no") {
						config.remoteOperations = false;
					} else {
						console.error("remoteOperations must be true or false");
						process.exit(1);
					}
					break;
				}
				case "autoCommit": {
					const boolValue = value.toLowerCase();
					if (boolValue === "true" || boolValue === "1" || boolValue === "yes") {
						config.autoCommit = true;
					} else if (boolValue === "false" || boolValue === "0" || boolValue === "no") {
						config.autoCommit = false;
					} else {
						console.error("autoCommit must be true or false");
						process.exit(1);
					}
					break;
				}
				case "zeroPaddedIds": {
					const padding = Number.parseInt(value, 10);
					if (Number.isNaN(padding) || padding < 0) {
						console.error("zeroPaddedIds must be a non-negative number.");
						process.exit(1);
					}
					// Set to undefined if 0 to remove it from config
					config.zeroPaddedIds = padding > 0 ? padding : undefined;
					break;
				}
				case "statuses":
				case "labels":
				case "milestones":
					console.error(`${key} cannot be set directly. Use 'backlog config list-${key}' to view current values.`);
					console.error("Array values should be edited in the config file directly.");
					process.exit(1);
					break;
				default:
					console.error(`Unknown config key: ${key}`);
					console.error(
						"Available keys: defaultEditor, projectName, defaultStatus, dateFormat, maxColumnWidth, autoOpenBrowser, defaultPort, remoteOperations, autoCommit, zeroPaddedIds",
					);
					process.exit(1);
			}

			await core.filesystem.saveConfig(config);
			console.log(`Set ${key} = ${value}`);
		} catch (err) {
			console.error("Failed to set config value", err);
			process.exitCode = 1;
		}
	});

configCmd
	.command("list")
	.description("list all configuration values")
	.action(async () => {
		try {
			const cwd = process.cwd();
			const core = new Core(cwd);
			const config = await core.filesystem.loadConfig();

			if (!config) {
				console.error("No backlog project found. Initialize one first with: backlog init");
				process.exit(1);
			}

			console.log("Configuration:");
			console.log(`  projectName: ${config.projectName}`);
			console.log(`  defaultEditor: ${config.defaultEditor || "(not set)"}`);
			console.log(`  defaultStatus: ${config.defaultStatus || "(not set)"}`);
			console.log(`  statuses: [${config.statuses.join(", ")}]`);
			console.log(`  labels: [${config.labels.join(", ")}]`);
			console.log(`  milestones: [${config.milestones.join(", ")}]`);
			console.log(`  dateFormat: ${config.dateFormat}`);
			console.log(`  maxColumnWidth: ${config.maxColumnWidth || "(not set)"}`);
			console.log(`  autoOpenBrowser: ${config.autoOpenBrowser ?? "(not set)"}`);
			console.log(`  defaultPort: ${config.defaultPort ?? "(not set)"}`);
			console.log(`  remoteOperations: ${config.remoteOperations ?? "(not set)"}`);
			console.log(`  autoCommit: ${config.autoCommit ?? "(not set)"}`);
			console.log(`  zeroPaddedIds: ${config.zeroPaddedIds ?? "(disabled)"}`);
		} catch (err) {
			console.error("Failed to list config values", err);
			process.exitCode = 1;
		}
	});

// Cleanup command for managing completed tasks
program
	.command("cleanup")
	.description("move completed tasks to completed folder based on age")
	.action(async () => {
		try {
			const cwd = process.cwd();
			const core = new Core(cwd);

			// Check if backlog project is initialized
			const config = await core.filesystem.loadConfig();
			if (!config) {
				console.error("No backlog project found. Initialize one first with: backlog init");
				process.exit(1);
			}

			// Get all Done tasks
			const tasks = await core.filesystem.listTasks();
			const doneTasks = tasks.filter((task) => task.status === "Done");

			if (doneTasks.length === 0) {
				console.log("No completed tasks found to clean up.");
				return;
			}

			console.log(`Found ${doneTasks.length} tasks marked as Done.`);

			const ageOptions = [
				{ title: "1 day", value: 1 },
				{ title: "1 week", value: 7 },
				{ title: "2 weeks", value: 14 },
				{ title: "3 weeks", value: 21 },
				{ title: "1 month", value: 30 },
				{ title: "3 months", value: 90 },
				{ title: "1 year", value: 365 },
			];

			const { selectedAge } = await prompts({
				type: "select",
				name: "selectedAge",
				message: "Move tasks to completed folder if they are older than:",
				choices: ageOptions,
				hint: "Tasks in completed folder are still accessible but won't clutter the main board",
			});

			if (selectedAge === undefined) {
				console.log("Cleanup cancelled.");
				return;
			}

			// Get tasks older than selected period
			const tasksToMove = await core.getDoneTasksByAge(selectedAge);

			if (tasksToMove.length === 0) {
				console.log(`No tasks found that are older than ${ageOptions.find((o) => o.value === selectedAge)?.title}.`);
				return;
			}

			console.log(
				`\nFound ${tasksToMove.length} tasks older than ${ageOptions.find((o) => o.value === selectedAge)?.title}:`,
			);
			for (const task of tasksToMove.slice(0, 5)) {
				const date = task.updatedDate || task.createdDate;
				console.log(`  - ${task.id}: ${task.title} (${date})`);
			}
			if (tasksToMove.length > 5) {
				console.log(`  ... and ${tasksToMove.length - 5} more`);
			}

			const { confirmed } = await prompts({
				type: "confirm",
				name: "confirmed",
				message: `Move ${tasksToMove.length} tasks to completed folder?`,
				initial: false,
			});

			if (!confirmed) {
				console.log("Cleanup cancelled.");
				return;
			}

			// Move tasks to completed folder
			let successCount = 0;
			const shouldAutoCommit = config.autoCommit ?? false;

			console.log("Moving tasks...");
			const movedTasks: Array<{ fromPath: string; toPath: string; taskId: string }> = [];

			for (const task of tasksToMove) {
				// Get paths before moving
				const taskPath = await getTaskPath(task.id, core);
				const taskFilename = await getTaskFilename(task.id, core);

				if (taskPath && taskFilename) {
					const fromPath = taskPath;
					const toPath = join(core.filesystem.completedDir, taskFilename);

					const success = await core.completeTask(task.id, shouldAutoCommit);
					if (success) {
						successCount++;
						movedTasks.push({ fromPath, toPath, taskId: task.id });
					} else {
						console.error(`Failed to move task ${task.id}`);
					}
				} else {
					console.error(`Failed to get paths for task ${task.id}`);
				}
			}

			// If autoCommit is disabled, stage the moves so Git recognizes them
			if (successCount > 0 && !shouldAutoCommit) {
				console.log("Staging file moves for Git...");
				for (const { fromPath, toPath } of movedTasks) {
					try {
						await core.gitOps.stageFileMove(fromPath, toPath);
					} catch (error) {
						console.warn(`Warning: Could not stage move for Git: ${error}`);
					}
				}
			}

			console.log(`Successfully moved ${successCount} of ${tasksToMove.length} tasks to completed folder.`);
			if (successCount > 0 && !shouldAutoCommit) {
				console.log("Files have been staged. To commit: git commit -m 'cleanup: Move completed tasks'");
			}
		} catch (err) {
			console.error("Failed to run cleanup", err);
			process.exitCode = 1;
		}
	});

// Browser command for web UI
program
	.command("browser")
	.description("open browser interface for task management (press Ctrl+C or Cmd+C to stop)")
	.option("-p, --port <port>", "port to run server on")
	.option("--no-open", "don't automatically open browser")
	.action(async (options) => {
		try {
			const cwd = process.cwd();
			const { BacklogServer } = await import("./server/index.ts");
			const server = new BacklogServer(cwd);

			// Load config to get default port
			const core = new Core(cwd);
			const config = await core.filesystem.loadConfig();
			const defaultPort = config?.defaultPort ?? 6420;

			const port = Number.parseInt(options.port || defaultPort.toString(), 10);
			if (Number.isNaN(port) || port < 1 || port > 65535) {
				console.error("Invalid port number. Must be between 1 and 65535.");
				process.exit(1);
			}

			await server.start(port, options.open !== false);

			// Keep the process running
			process.on("SIGINT", async () => {
				console.log("\nShutting down server...");
				await server.stop();
				process.exit(0);
			});
		} catch (err) {
			console.error("Failed to start browser interface", err);
			process.exitCode = 1;
		}
	});

program.parseAsync(process.argv).finally(() => {
	// Restore BUN_OPTIONS after CLI parsing completes so it's available for subsequent commands
	if (originalBunOptions) {
		process.env.BUN_OPTIONS = originalBunOptions;
	}
});
