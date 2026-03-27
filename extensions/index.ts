/**
 * Skills Extension
 *
 * Provides a /skills command to enable/disable skills interactively.
 * Uses the same settings-based mechanism as `pi config` — writes +/- patterns
 * to settings.json, then optionally reloads to apply changes.
 *
 * UI modeled after pi config's ConfigSelectorComponent: grouped entries,
 * checkbox toggles, search/filter, scroll, keyboard navigation.
 */

import type {
	ExtensionAPI,
	ResolvedResource,
	PackageSource,
} from "@mariozechner/pi-coding-agent";
import {
	DefaultPackageManager,
	DynamicBorder,
	rawKeyHint,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
	Container,
	getKeybindings,
	Input,
	matchesKey,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { basename, dirname, join, relative } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillItem {
	path: string;
	enabled: boolean;
	metadata: ResolvedResource["metadata"];
	displayName: string;
	groupKey: string;
}

interface SkillGroup {
	key: string;
	label: string;
	scope: string;
	origin: string;
	source: string;
	items: SkillItem[];
}

type FlatEntry =
	| { type: "group"; group: SkillGroup }
	| { type: "item"; item: SkillItem };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

function getGroupLabel(metadata: ResolvedResource["metadata"]): string {
	if (metadata.origin === "package") {
		return `${metadata.source} (${metadata.scope})`;
	}
	if (metadata.source === "auto") {
		return metadata.scope === "user" ? "User (~/.pi/agent/)" : "Project (.pi/)";
	}
	return metadata.scope === "user" ? "User settings" : "Project settings";
}

function buildGroups(skills: ResolvedResource[]): SkillGroup[] {
	const groupMap = new Map<string, SkillGroup>();

	for (const res of skills) {
		const { path, enabled, metadata } = res;
		const groupKey = `${metadata.origin}:${metadata.scope}:${metadata.source}`;

		if (!groupMap.has(groupKey)) {
			groupMap.set(groupKey, {
				key: groupKey,
				label: getGroupLabel(metadata),
				scope: metadata.scope,
				origin: metadata.origin,
				source: metadata.source,
				items: [],
			});
		}

		const fileName = basename(path);
		const parentFolder = basename(dirname(path));
		const displayName =
			fileName === "SKILL.md"
				? parentFolder
				: fileName.endsWith(".md")
					? fileName.replace(/\.md$/, "")
					: fileName;

		groupMap.get(groupKey)!.items.push({
			path,
			enabled,
			metadata,
			displayName,
			groupKey,
		});
	}

	const groups = Array.from(groupMap.values());
	groups.sort((a, b) => {
		if (a.origin !== b.origin) return a.origin === "package" ? -1 : 1;
		if (a.scope !== b.scope) return a.scope === "user" ? -1 : 1;
		return a.source.localeCompare(b.source);
	});

	for (const group of groups) {
		group.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
	}

	return groups;
}

// ---------------------------------------------------------------------------
// Settings toggle — same mechanism as pi config's config-selector.js
// ---------------------------------------------------------------------------

function getTopLevelPattern(item: SkillItem, cwd: string): string {
	const agentDir = getAgentDir();
	const projectBaseDir = join(cwd, ".pi");
	const baseDir = item.metadata.scope === "project" ? projectBaseDir : agentDir;
	return relative(baseDir, item.path);
}

function getPackagePattern(item: SkillItem): string {
	const baseDir = item.metadata.baseDir ?? dirname(item.path);
	return relative(baseDir, item.path);
}

function stripPrefix(p: string): string {
	if (p.startsWith("!") || p.startsWith("+") || p.startsWith("-")) {
		return p.slice(1);
	}
	return p;
}

function toggleTopLevel(
	item: SkillItem,
	enabled: boolean,
	sm: SettingsManager,
	cwd: string,
): void {
	const scope = item.metadata.scope;
	const settings =
		scope === "project" ? sm.getProjectSettings() : sm.getGlobalSettings();
	const current: string[] = [...(settings.skills ?? [])];
	const pattern = getTopLevelPattern(item, cwd);

	const updated = current.filter((p) => stripPrefix(p) !== pattern);
	updated.push(enabled ? `+${pattern}` : `-${pattern}`);

	if (scope === "project") {
		sm.setProjectSkillPaths(updated);
	} else {
		sm.setSkillPaths(updated);
	}
}

function togglePackage(
	item: SkillItem,
	enabled: boolean,
	sm: SettingsManager,
): void {
	const scope = item.metadata.scope;
	const settings =
		scope === "project" ? sm.getProjectSettings() : sm.getGlobalSettings();
	const packages: PackageSource[] = [...(settings.packages ?? [])];

	const pkgIndex = packages.findIndex((pkg) => {
		const source = typeof pkg === "string" ? pkg : pkg.source;
		return source === item.metadata.source;
	});
	if (pkgIndex === -1) return;

	let pkg = packages[pkgIndex];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		packages[pkgIndex] = pkg;
	}

	const current: string[] = [...(pkg.skills ?? [])];
	const pattern = getPackagePattern(item);

	const updated = current.filter((p) => stripPrefix(p) !== pattern);
	updated.push(enabled ? `+${pattern}` : `-${pattern}`);

	pkg.skills = updated.length > 0 ? updated : undefined;

	const hasFilters =
		pkg.extensions !== undefined ||
		pkg.skills !== undefined ||
		pkg.prompts !== undefined ||
		pkg.themes !== undefined;
	if (!hasFilters) {
		packages[pkgIndex] = pkg.source;
	}

	if (scope === "project") {
		sm.setProjectPackages(packages);
	} else {
		sm.setPackages(packages);
	}
}

function toggleSkill(
	item: SkillItem,
	enabled: boolean,
	sm: SettingsManager,
	cwd: string,
): void {
	if (item.metadata.origin === "top-level") {
		toggleTopLevel(item, enabled, sm, cwd);
	} else {
		togglePackage(item, enabled, sm);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function skillsExtension(pi: ExtensionAPI) {
	pi.registerCommand("skills", {
		description: "Enable/disable skills",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const agentDir = getAgentDir();
			const sm = SettingsManager.create(cwd, agentDir);
			const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager: sm });

			const resolved = await pm.resolve();
			const skillResources = resolved.skills;

			if (skillResources.length === 0) {
				ctx.ui.notify("No skills found.", "info");
				return;
			}

			const groups = buildGroups(skillResources);

			// Build flat list for navigation
			const flatItems: FlatEntry[] = [];
			for (const group of groups) {
				flatItems.push({ type: "group", group });
				for (const item of group.items) {
					flatItems.push({ type: "item", item });
				}
			}

			let changeCount = 0;

			await ctx.ui.custom((tui, theme, _kb, done) => {
				// --- State ---
				let filteredItems: FlatEntry[] = [...flatItems];
				let selectedIndex = filteredItems.findIndex((e) => e.type === "item");
				if (selectedIndex < 0) selectedIndex = 0;
				const searchInput = new Input();

				// --- Helpers ---
				function findNextItem(from: number, dir: number): number {
					let idx = from + dir;
					while (idx >= 0 && idx < filteredItems.length) {
						if (filteredItems[idx].type === "item") return idx;
						idx += dir;
					}
					return from;
				}

				function filterItems(query: string): void {
					if (!query.trim()) {
						filteredItems = [...flatItems];
						selectFirstItem();
						return;
					}
					const lq = query.toLowerCase();
					const matchingItems = new Set<SkillItem>();
					const matchingGroups = new Set<SkillGroup>();

					for (const entry of flatItems) {
						if (entry.type === "item") {
							const it = entry.item;
							if (
								it.displayName.toLowerCase().includes(lq) ||
								it.path.toLowerCase().includes(lq) ||
								it.metadata.source.toLowerCase().includes(lq)
							) {
								matchingItems.add(it);
							}
						}
					}

					for (const group of groups) {
						for (const it of group.items) {
							if (matchingItems.has(it)) {
								matchingGroups.add(group);
							}
						}
					}

					filteredItems = [];
					for (const entry of flatItems) {
						if (entry.type === "group" && matchingGroups.has(entry.group)) {
							filteredItems.push(entry);
						} else if (entry.type === "item" && matchingItems.has(entry.item)) {
							filteredItems.push(entry);
						}
					}
					selectFirstItem();
				}

				function selectFirstItem(): void {
					const idx = filteredItems.findIndex((e) => e.type === "item");
					selectedIndex = idx >= 0 ? idx : 0;
				}

				// --- Header ---
				const header = {
					invalidate() {},
					render(width: number) {
						const title = theme.bold("Skill Configuration");
						const sep = theme.fg("muted", " \u00b7 ");
						const hint =
							rawKeyHint("space", "toggle") +
							sep +
							rawKeyHint("esc", "close");
						const hintWidth = visibleWidth(hint);
						const titleWidth = visibleWidth(title);
						const spacing = Math.max(1, width - titleWidth - hintWidth);
						return [
							truncateToWidth(
								`${title}${" ".repeat(spacing)}${hint}`,
								width,
								"",
							),
							theme.fg("muted", "Type to filter skills"),
						];
					},
				};

				// --- List ---
				const maxVisible = 15;
				const list = {
					invalidate() {},
					render(width: number) {
						const lines: string[] = [];

						// Search input
						lines.push(...searchInput.render(width));
						lines.push("");

						if (filteredItems.length === 0) {
							lines.push(theme.fg("muted", "  No skills found"));
							return lines;
						}

						const startIndex = Math.max(
							0,
							Math.min(
								selectedIndex - Math.floor(maxVisible / 2),
								filteredItems.length - maxVisible,
							),
						);
						const endIndex = Math.min(
							startIndex + maxVisible,
							filteredItems.length,
						);

						for (let i = startIndex; i < endIndex; i++) {
							const entry = filteredItems[i];
							const isSelected = i === selectedIndex;

							if (entry.type === "group") {
								const groupLine = theme.fg(
									"accent",
									theme.bold(entry.group.label),
								);
								lines.push(truncateToWidth(`  ${groupLine}`, width, ""));
							} else {
								const cursor = isSelected ? "> " : "  ";
								const checkbox = entry.item.enabled
									? theme.fg("success", "[x]")
									: theme.fg("dim", "[ ]");
								const name = isSelected
									? theme.bold(entry.item.displayName)
									: entry.item.displayName;
								lines.push(
									truncateToWidth(
										`${cursor}    ${checkbox} ${name}`,
										width,
										"...",
									),
								);
							}
						}

						if (startIndex > 0 || endIndex < filteredItems.length) {
							lines.push(
								theme.fg(
									"dim",
									`  (${selectedIndex + 1}/${filteredItems.length})`,
								),
							);
						}

						return lines;
					},
				};

				// --- Container ---
				const container = new Container();
				container.addChild(new Spacer(1));
				container.addChild(new DynamicBorder());
				container.addChild(new Spacer(1));
				container.addChild(header);
				container.addChild(new Spacer(1));
				container.addChild(list);
				container.addChild(new Spacer(1));
				container.addChild(new DynamicBorder());

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						const kb = getKeybindings();

						if (kb.matches(data, "tui.select.up")) {
							selectedIndex = findNextItem(selectedIndex, -1);
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.down")) {
							selectedIndex = findNextItem(selectedIndex, 1);
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.pageUp")) {
							let target = Math.max(0, selectedIndex - maxVisible);
							while (
								target < filteredItems.length &&
								filteredItems[target].type !== "item"
							) {
								target++;
							}
							if (target < filteredItems.length) selectedIndex = target;
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.pageDown")) {
							let target = Math.min(
								filteredItems.length - 1,
								selectedIndex + maxVisible,
							);
							while (
								target >= 0 &&
								filteredItems[target].type !== "item"
							) {
								target--;
							}
							if (target >= 0) selectedIndex = target;
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.cancel")) {
							done(undefined);
							return;
						}
						if (matchesKey(data, "ctrl+c")) {
							done(undefined);
							return;
						}
						if (
							data === " " ||
							kb.matches(data, "tui.select.confirm")
						) {
							const entry = filteredItems[selectedIndex];
							if (entry?.type === "item") {
								const newEnabled = !entry.item.enabled;
								toggleSkill(entry.item, newEnabled, sm, cwd);
								entry.item.enabled = newEnabled;
								// Update in groups too
								for (const group of groups) {
									const found = group.items.find(
										(i) => i.path === entry.item.path,
									);
									if (found) {
										found.enabled = newEnabled;
									}
								}
								changeCount++;
							}
							tui.requestRender();
							return;
						}

						// Pass to search input
						searchInput.handleInput(data);
						filterItems(searchInput.getValue());
						tui.requestRender();
					},
				};
			});

			// After UI closes, prompt reload if changes were made
			if (changeCount > 0) {
				const shouldReload = await ctx.ui.confirm(
					"Reload Required",
					`${changeCount} skill change(s) saved. Reload pi now?`,
				);
				if (shouldReload) {
					await ctx.reload();
					return;
				}
				ctx.ui.notify(
					"Changes saved to settings. Use /reload to apply.",
					"info",
				);
			}
		},
	});
}
