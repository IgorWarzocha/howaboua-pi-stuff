export const SETTINGS_TABS = [
	{ id: "adapter", label: "Adapter" },
	{ id: "tools", label: "Tools" },
	{ id: "openai", label: "OpenAI" },
	{ id: "display", label: "Display" },
	{ id: "voice", label: "Voice" },
	{ id: "usage", label: "Usage" },
	{ id: "about", label: "About" },
] as const;

export type SettingsTab = typeof SETTINGS_TABS[number]["id"];

export function parseSettingsTab(value: string): SettingsTab | undefined {
	return SETTINGS_TABS.find((tab) => tab.id === value)?.id;
}
