import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);
let stage = "inputs";
try {
  if (
    !process.env.GITHUB_ACTIONS ||
    !process.env.RUNNER_TEMP ||
    !process.env.COCO_SIGNING_P12 ||
    !process.env.COCO_SIGNING_PASSWORD
  )
    throw new Error("MISSING");
  const pin = JSON.parse(await readFile("apps/desktop/resources/signing/identity.json", "utf8"));
  const directory = join(process.env.RUNNER_TEMP, "codex-coco-signing");
  await mkdir(directory, { mode: 0o700 });
  const p12 = join(directory, "identity.p12");
  const pass = join(directory, "password.txt");
  const certificate = join(directory, "certificate.crt");
  const keychain = join(directory, "signing.keychain-db");
  const pem = await readFile("apps/desktop/resources/signing/certificate.crt");
  if (new X509Certificate(pem).fingerprint256 !== pin.sha256) throw new Error("PIN");
  await writeFile(p12, Buffer.from(process.env.COCO_SIGNING_P12, "base64"), { mode: 0o600 });
  await writeFile(pass, process.env.COCO_SIGNING_PASSWORD, { mode: 0o600 });
  await writeFile(certificate, pem);
  const password = randomBytes(32).toString("hex");
  stage = "create-keychain";
  await exec("security", ["create-keychain", "-p", password, keychain]);
  await exec("security", ["unlock-keychain", "-p", password, keychain]);
  await exec("security", ["set-keychain-settings", "-lut", "21600", keychain]);
  await exec("security", ["list-keychains", "-d", "user", "-s", keychain]);
  stage = "import-identity";
  await exec("security", [
    "import",
    p12,
    "-k",
    keychain,
    "-P",
    process.env.COCO_SIGNING_PASSWORD,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/security",
  ]);
  await exec("security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  // Trust exists only on the disposable GitHub runner, never on an end user's machine.
  stage = "trust-runner-certificate";
  await exec("sudo", [
    "-n",
    "security",
    "add-trusted-cert",
    "-d",
    "-r",
    "trustRoot",
    "-p",
    "codeSign",
    "-k",
    "/Library/Keychains/System.keychain",
    certificate,
  ]);
  stage = "find-identity";
  const found = await exec("security", ["find-identity", "-v", "-p", "codesigning", keychain]);
  if (!found.stdout.includes(pin.sha1)) throw new Error("IDENTITY");
  const probeSource = join(directory, "probe.c");
  const probeBinary = join(directory, "probe");
  await writeFile(probeSource, "int main(void) { return 0; }\n");
  stage = "compile-probe";
  await exec("clang", [probeSource, "-o", probeBinary]);
  stage = "sign-probe";
  await exec("codesign", [
    "--force",
    "--sign",
    pin.sha1,
    "--keychain",
    keychain,
    "--timestamp=none",
    probeBinary,
  ]);
  stage = "verify-probe";
  await exec("codesign", ["--verify", "--strict", "-R", `anchor H"${pin.sha1}"`, probeBinary]);
  await appendFile(
    process.env.GITHUB_ENV,
    `CSC_KEYCHAIN=${keychain}\nCSC_NAME=${pin.commonName}\nCSC_IDENTITY_AUTO_DISCOVERY=false\n`,
  );
  console.log("Pinned self-signed identity installed on disposable runner.");
} catch (error) {
  const reason = /specified item could not be found/i.test(String(error.stderr))
    ? "KEYCHAIN_ITEM_NOT_FOUND"
    : /error:/i.test(String(error.stderr))
      ? "TOOL_REJECTED"
      : "SETUP_FAILED";
  console.error(`Release signing setup failed at ${stage}: ${reason}.`);
  process.exitCode = 1;
}
