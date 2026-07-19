#!/usr/bin/env node

const prompt = process.argv.slice(2).join(" ").toLowerCase();
if (prompt.includes("username")) {
  process.stdout.write(process.env.SITES_GIT_USERNAME || "x-access-token");
} else {
  process.stdout.write(process.env.SITES_GIT_TOKEN || "");
}
