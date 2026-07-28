export const SETTINGS_TABS = [
	{ id: "adapter", label: "General" },
	{ id: "tools", label: "Tools" },
	{ id: "openai", label: "OpenAI" },
	{ id: "display", label: "Display" },
	{ id: "voice", label: "Voice" },
	{ id: "usage", label: "Usage" },
	{ id: "about", label: "About" },
] as const;

export type SettingsTab = typeof SETTINGS_TABS[number]["id"];

export const ROUTABLE_SETTINGS_TABS = SETTINGS_TABS.slice(1);

export function parseSettingsTab(value: string): SettingsTab | undefined {
	return ROUTABLE_SETTINGS_TABS.find((tab) => tab.id === value)?.id;
}
