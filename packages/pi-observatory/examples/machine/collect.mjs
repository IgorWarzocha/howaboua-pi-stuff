import {
	availableParallelism,
	freemem,
	hostname,
	loadavg,
	platform,
	totalmem,
	uptime,
} from "node:os";

console.log(
	JSON.stringify({
		hostname: hostname(),
		platform: platform(),
		logicalCpus: availableParallelism(),
		memoryTotalBytes: totalmem(),
		memoryFreeBytes: freemem(),
		uptimeSeconds: uptime(),
		load1: loadavg()[0],
	}),
);
