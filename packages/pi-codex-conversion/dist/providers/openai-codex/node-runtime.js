var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
const dynamicImport = (specifier) => import(__rewriteRelativeImportExtension(specifier));
let fsPromisesPromise;
export async function getNodeFsPromises() {
    if (!fsPromisesPromise) {
        fsPromisesPromise = dynamicImport("node:fs/promises");
    }
    return fsPromisesPromise;
}
export function getNodeFsSync() {
    if (typeof process === "undefined" || !(process.versions?.node || process.versions["bun"])) {
        return null;
    }
    const builtinProcess = process;
    if (typeof builtinProcess.getBuiltinModule !== "function") {
        return null;
    }
    try {
        const module = builtinProcess.getBuiltinModule("node:fs");
        if (typeof module?.readFileSync !== "function")
            return null;
        return { readFileSync: module.readFileSync };
    }
    catch {
        return null;
    }
}
export const osInfo = { current: null };
if (typeof process !== "undefined" && (process.versions?.node || process.versions["bun"])) {
    dynamicImport("node:os")
        .then((module) => {
        osInfo.current = module;
    })
        .catch(() => {
        osInfo.current = null;
    });
}
