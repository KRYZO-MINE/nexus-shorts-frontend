const fs = require("node:fs");
const path = require("node:path");

const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8000";
if (!/^https?:\/\/[^/]+/i.test(apiBaseUrl)) {
  throw new Error("API_BASE_URL must be an absolute HTTP(S) URL.");
}

const target = path.join(__dirname, "..", "config", "config.js");
const config = `window.NEXUS_CONFIG = Object.freeze({ API_BASE_URL: ${JSON.stringify(apiBaseUrl.replace(/\/+$/, ""))} });\n`;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, config, "utf8");

const root = path.join(__dirname, "..");
const output = path.join(root, "dist");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const name of ["index.html", "css", "js", "config", "assets"]) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) {
    fs.cpSync(source, path.join(output, name), { recursive: true });
  }
}
