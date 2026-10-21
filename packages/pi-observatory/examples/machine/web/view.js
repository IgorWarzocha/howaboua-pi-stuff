import { connectTab } from "/tab-client.js";

const waiting = document.getElementById("waiting");
const stats = document.getElementById("stats");
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

connectTab(({ data }) => {
	if (!data) return;
	if (
		typeof data !== "object" ||
		typeof data.hostname !== "string" ||
		typeof data.platform !== "string" ||
		![
			"logicalCpus",
			"memoryTotalBytes",
			"memoryFreeBytes",
			"uptimeSeconds",
			"load1",
		].every(
			(key) => typeof data[key] === "number" && Number.isFinite(data[key]),
		) ||
		data.memoryTotalBytes <= 0
	) {
		waiting.hidden = false;
		waiting.textContent =
			"The snapshot does not match this page. Check the collector output.";
		stats.hidden = true;
		return;
	}
	waiting.hidden = true;
	stats.hidden = false;
	document.getElementById("host").textContent = data.hostname;
	document.getElementById("platform").textContent = data.platform;
	document.getElementById("cpus").textContent =
		data.logicalCpus.toLocaleString();
	const used = data.memoryTotalBytes - data.memoryFreeBytes;
	document.getElementById("memory").textContent =
		`${gib(used)} / ${gib(data.memoryTotalBytes)}`;
	document.getElementById("memory-meter").value =
		(used / data.memoryTotalBytes) * 100;
	const days = Math.floor(data.uptimeSeconds / 86400);
	const hours = Math.floor((data.uptimeSeconds % 86400) / 3600);
	document.getElementById("uptime").textContent =
		`${days} days, ${hours} hours`;
	document.getElementById("load").textContent = data.load1.toFixed(2);
});
