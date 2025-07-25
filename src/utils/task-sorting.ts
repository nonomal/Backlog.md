/**
 * Parse a task ID into its numeric components for proper sorting.
 * Handles both simple IDs (task-5) and decimal IDs (task-5.2.1)
 */
export function parseTaskId(taskId: string): number[] {
	// Remove the "task-" prefix if present
	const numericPart = taskId.replace(/^task-/, "");

	// Try to extract numeric parts from the ID
	// First check if it's a standard numeric ID (e.g., "1", "1.2", etc.)
	const dotParts = numericPart.split(".");
	const numericParts = dotParts.map((part) => {
		const num = Number.parseInt(part, 10);
		return Number.isNaN(num) ? null : num;
	});

	// If all parts are numeric, return them
	if (numericParts.every((n) => n !== null)) {
		return numericParts as number[];
	}

	// Otherwise, try to extract trailing number (e.g., "draft2" -> 2)
	const trailingNumberMatch = numericPart.match(/(\d+)$/);
	if (trailingNumberMatch) {
		return [Number.parseInt(trailingNumberMatch[1]!, 10)];
	}

	// No numeric parts found, return 0 for consistent sorting
	return [0];
}

/**
 * Compare two task IDs numerically.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 *
 * Examples:
 * - task-2 comes before task-10
 * - task-2 comes before task-2.1
 * - task-2.1 comes before task-2.2
 * - task-2.2 comes before task-2.10
 */
export function compareTaskIds(a: string, b: string): number {
	const aParts = parseTaskId(a);
	const bParts = parseTaskId(b);

	// Compare each numeric part
	const maxLength = Math.max(aParts.length, bParts.length);

	for (let i = 0; i < maxLength; i++) {
		const aNum = aParts[i] ?? 0;
		const bNum = bParts[i] ?? 0;

		if (aNum !== bNum) {
			return aNum - bNum;
		}
	}

	// All parts are equal
	return 0;
}

/**
 * Sort an array of objects by their task ID property numerically.
 * Returns a new sorted array without mutating the original.
 */
export function sortByTaskId<T extends { id: string }>(items: T[]): T[] {
	return [...items].sort((a, b) => compareTaskIds(a.id, b.id));
}

/**
 * Sort an array of tasks by their priority property.
 * Priority order: high > medium > low > undefined
 * Tasks with the same priority are sorted by task ID.
 */
export function sortByPriority<T extends { id: string; priority?: "high" | "medium" | "low" }>(items: T[]): T[] {
	const priorityWeight = {
		high: 3,
		medium: 2,
		low: 1,
	};

	return [...items].sort((a, b) => {
		const aWeight = a.priority ? priorityWeight[a.priority] : 0;
		const bWeight = b.priority ? priorityWeight[b.priority] : 0;

		// First sort by priority (higher weight = higher priority)
		if (aWeight !== bWeight) {
			return bWeight - aWeight;
		}

		// If priorities are the same, sort by task ID
		return compareTaskIds(a.id, b.id);
	});
}

/**
 * Sort tasks by a specified field with fallback to task ID sorting.
 * Supported fields: 'priority', 'id'
 */
export function sortTasks<T extends { id: string; priority?: "high" | "medium" | "low" }>(
	items: T[],
	sortField: string,
): T[] {
	switch (sortField?.toLowerCase()) {
		case "priority":
			return sortByPriority(items);
		case "id":
			return sortByTaskId(items);
		default:
			// Default to task ID sorting for unknown fields
			return sortByTaskId(items);
	}
}
