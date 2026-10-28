import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
const run = promisify(execFile);
const exec = (command, args) => run(command, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
const appRequire = createRequire(resolve("apps/desktop/package.json"));
const { build, Platform, Arch } = appRequire("electron-builder");
const buildOnly = process.argv.includes("--build-only");
const verifyOnly = process.argv.includes("--verify-only");
assert(buildOnly !== verifyOnly, "Select --build-only or --verify-only.");
const electronDist = buildOnly
  ? dirname(dirname(dirname(dirname(appRequire("electron")))))
  : undefined;
const pin = JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8"));
const root = await mkdtemp(join(tmpdir(), "codex-coco-native-update-"));
const controlDirectory = join(homedir(), "Library/Application Support/Codex Coco Update Probe");
await mkdir(controlDirectory, { recursive: true });
const control = join(controlDirectory, "control.json");
const marker = join(controlDirectory, "events.jsonl");
const appName = "Codex Coco Update Probe";
let payload;
const children = [];
const server = createServer(async (request, response) => {
  if (request.url === "/feed") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/update.zip` }));
  } else if (request.url === "/update.zip") {
    response.setHeader("Content-Type", "application/zip");
    response.end(await readFile(payload));
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const main = `const {app,autoUpdater}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const directory=path.join(require('node:os').homedir(),'Library/Application Support/Codex Coco Update Probe');
const write=(event)=>fs.appendFileSync(path.join(directory,'events.jsonl'),JSON.stringify({event,version:app.getVersion()})+'\\n');
app.whenReady().then(()=>{
 if(app.getVersion()==='0.0.2'){write('installed');app.quit();return;}
 autoUpdater.on('error',()=>{write('rejected');app.quit();});
 autoUpdater.on('update-downloaded',()=>{write('downloaded');setTimeout(()=>autoUpdater.quitAndInstall(),100);});
 const control=JSON.parse(fs.readFileSync(path.join(directory,'control.json'),'utf8'));
 autoUpdater.setFeedURL({url:control.url});write('checking');autoUpdater.checkForUpdates();
});`;
async function make(version) {
  const source = join(root, `source-${version}`);
  await mkdir(source);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "codex-coco-update-probe",
      version,
      main: "main.cjs",
      description: "Isolated update verification",
      author: "Codex Coco",
      license: "MIT",
    }),
  );
  await writeFile(join(source, "main.cjs"), main);
  await writeFile(join(source, "probe.txt"), "signed-resource");
  const output = join(root, `build-${version}`);
  await build({
    projectDir: source,
    targets: Platform.MAC.createTarget("dir", Arch.arm64),
    publish: "never",
    config: {
      appId: "dev.codex-coco.update-probe",
      productName: appName,
      electronVersion: appRequire("electron/package.json").version,
      electronDist,
      directories: { output },
      files: ["main.cjs", "package.json"],
      extraResources: [{ from: "probe.txt", to: "probe.txt" }],
      forceCodeSigning: true,
      mac: {
        identity: pin.commonName,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        notarize: false,
        timestamp: "none",
        extendInfo: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
      },
    },
  });
  return join(output, "mac-arm64", `${appName}.app`);
}
async function archive(app, name) {
  console.log(`Archiving ${name}.`);
  const file = join(root, `${name}.zip`);
  await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, file]);
  console.log(`Archived ${name}.`);
  return file;
}
async function runCase(name, zip, expected) {
  const directory = join(root, name);
  await mkdir(directory);
  const installed = join(directory, `${appName}.app`);
  await cp(oldApp, installed, { recursive: true, verbatimSymlinks: true });
  await writeFile(marker, "");
  await writeFile(
    control,
    JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/feed` }),
  );
  payload = zip;
  console.log(`Starting ${name}.`);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(join(installed, "Contents/MacOS", appName), [], {
    stdio: "ignore",
    env: environment,
  });
  children.push(child);
  const deadline = Date.now() + 60000;
  let events = [];
  while (Date.now() < deadline) {
    events = (await readFile(marker, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    if (events.some((event) => event.event === expected)) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert(
    events.some((event) => event.event === expected),
    `${name}: ${JSON.stringify(events)}`,
  );
  if (expected === "rejected")
    assert(!events.some((event) => event.event === "downloaded" || event.event === "installed"));
  if (expected === "installed") {
    assert(events.some((event) => event.event === "installed" && event.version === "0.0.2"));
    const version = await exec("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleShortVersionString",
      join(installed, "Contents/Info.plist"),
    ]);
    assert.equal(version.stdout.trim(), "0.0.2");
  }
  console.log(JSON.stringify({ case: name, ok: true, events }));
  child.kill();
}
let oldApp;
try {
  if (buildOnly) {
    console.log("Building baseline fixture.");
    oldApp = await make("0.0.1");
    console.log("Building candidate fixture.");
    const newApp = await make("0.0.2");
    await mkdir("work/native-probes", { recursive: true });
    await cp(await archive(oldApp, "baseline"), "work/native-probes/baseline.zip");
    await cp(await archive(newApp, "candidate"), "work/native-probes/candidate.zip");
    console.log("Signed fixture archives ready for a separate recipient runner.");
  } else {
    const certificate = resolve("apps/desktop/resources/signing/certificate.crt");
    let untrusted = false;
    try {
      await exec("security", ["verify-cert", "-L", "-l", "-c", certificate, "-p", "codeSign"]);
    } catch {
      untrusted = true;
    }
    assert(untrusted, "Recipient runner must not trust the self-signed certificate.");
    console.log("Recipient runner has never imported the signing identity or trusted certificate.");
    const baseline = join(root, "baseline");
    const candidate = join(root, "candidate");
    await exec("ditto", ["-x", "-k", resolve("work/native-probes/baseline.zip"), baseline]);
    await exec("ditto", ["-x", "-k", resolve("work/native-probes/candidate.zip"), candidate]);
    oldApp = join(baseline, `${appName}.app`);
    const newApp = join(candidate, `${appName}.app`);
    const rogue = join(root, "rogue", `${appName}.app`);
    await cp(newApp, rogue, { recursive: true, verbatimSymlinks: true });
    await exec("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", rogue]);
    await runCase("wrong-signer", await archive(rogue, "wrong-signer"), "rejected");
    const tampered = join(root, "tampered", `${appName}.app`);
    await cp(newApp, tampered, { recursive: true, verbatimSymlinks: true });
    await writeFile(join(tampered, "Contents/Resources/probe.txt"), "tampered-resource");
    await runCase("tampered-resource", await archive(tampered, "tampered"), "rejected");
    await runCase("same-certificate", resolve("work/native-probes/candidate.zip"), "installed");
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
  await rm(controlDirectory, { recursive: true, force: true });
}
