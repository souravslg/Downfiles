// https://github.com/yt-dlp/ejs/blob/main/check.py
import * as path from "node:path";
import * as fs from "node:fs";

const serverHome = path.resolve(import.meta.dirname, "..");

function downgradeLock(lockfile): void {
    const { version } = lockfile;
    if (version === "4") return;
    if (version !== "5")
        throw new Error(`Invalid deno.lock version: ${version}`);
    console.log("blindly downgrading deno.lock from v5 to v4");
    lockfile.version = "4";
}

function getDenoPkgs(lockfile) {
    const pkgs: Record<string, string> = {};
    const { version, npm } = lockfile;
    if (version !== "4" && version !== "5")
        throw new Error(`Unsupported deno.lock lockfile version ${version}`);

    for (const name in npm) {
        const { integrity } = npm[name];
        const other = pkgs[integrity];
        if (other && other !== name)
            throw new Error(
                `Duplicate integrity for ${name} and ${other}: ${integrity}`);
        pkgs[integrity] = name;
    }
    return pkgs;
}

function getNodePkgs(lockfile) {
    const pkgs: Record<string, string> = {};
    const { lockfileVersion: version , packages: npm } = lockfile;
    if (version !== 3)
        throw new Error(
            `Unsupported package-lock.json lockfile version ${version}`);

    for (const name in npm) {
        if (!name.length) continue;
        const module = name.split("node_modules/").pop();
        const { version, integrity } = npm[name];
        const pkgSpec = `${module}@${version}`;
        const other = pkgs[integrity];
        if (other && other !== pkgSpec)
            throw new Error(
                `Duplicate integrity for ${pkgSpec} and ${other}: ${integrity}`);
        pkgs[integrity] = pkgSpec;
    }
    return pkgs;
}

try {
    const denoPath = path.resolve(serverHome, "deno.lock");
    const denoLock = JSON.parse(fs.readFileSync(denoPath).toString());
    downgradeLock(denoLock);
    fs.writeFileSync(denoPath, JSON.stringify(denoLock, null, 2) + "\n");

    const denoPkgs = getDenoPkgs(denoLock);
    const nodePkgs = getNodePkgs(JSON.parse(fs.readFileSync(path.resolve(
        serverHome, "package-lock.json")).toString()));

    for (const denoIt in denoPkgs)
        if (!(denoIt in nodePkgs))
            console.log(`Deno extra: ${denoPkgs[denoIt]}, integrity ${denoIt}`);

    for (const nodeIt in nodePkgs)
        if (!(nodeIt in denoPkgs))
            console.log(`Node extra: ${nodePkgs[nodeIt]}, integrity ${nodeIt}`);
} catch (e) {
    console.error(`ERROR: ${e.message}`);
}
