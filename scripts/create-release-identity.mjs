import { generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const privateDirectory = join(homedir(), "Library/Application Support/Codex Coco/release-signing");
const publicDirectory = resolve("apps/desktop/resources/signing");
const identity = "Codex Coco Update Signing";
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
await chmod(privateDirectory, 0o700);
const passwordFile = join(privateDirectory, "password.txt");
const key = join(privateDirectory, "private-key.pem");
const certificate = join(privateDirectory, "certificate.crt");
const p12 = join(privateDirectory, "identity.p12");
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
if (!(await exists(passwordFile)) && !(await exists(key)) && !(await exists(certificate))) {
  const password = randomBytes(32).toString("hex");
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: password,
    },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(passwordFile, password + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(key, pair.privateKey, { mode: 0o600, flag: "wx" });
}
if (!(await exists(passwordFile)) || !(await exists(key)))
  throw new Error("Incomplete identity; refusing to rotate signing material.");
const password = (await readFile(passwordFile, "utf8")).trim();
const environment = { ...process.env, COCO_CREATE_PASSWORD: password };
if (!(await exists(certificate))) {
  const config = join(privateDirectory, "certificate.cnf");
  await writeFile(
    config,
    `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=${identity}\nO=Codex Coco\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=codeSigning\n`,
    { mode: 0o600 },
  );
  await exec(
    "/usr/bin/openssl",
    [
      "req",
      "-new",
      "-x509",
      "-sha256",
      "-days",
      "3650",
      "-key",
      key,
      "-passin",
      "env:COCO_CREATE_PASSWORD",
      "-out",
      certificate,
      "-config",
      config,
    ],
    { env: environment },
  );
}
if (!(await exists(p12))) {
  await exec(
    "/usr/bin/openssl",
    [
      "pkcs12",
      "-export",
      "-inkey",
      key,
      "-passin",
      "env:COCO_CREATE_PASSWORD",
      "-in",
      certificate,
      "-name",
      identity,
      "-out",
      p12,
      "-passout",
      "env:COCO_CREATE_PASSWORD",
    ],
    { env: environment },
  );
  await chmod(p12, 0o600);
}
await exec(
  "/usr/bin/openssl",
  ["pkcs12", "-in", p12, "-passin", "env:COCO_CREATE_PASSWORD", "-noout"],
  { env: environment },
);
const pem = await readFile(certificate, "utf8");
const cert = new X509Certificate(pem);
await mkdir(publicDirectory, { recursive: true });
if (await exists(join(publicDirectory, "identity.json"))) {
  const pin = JSON.parse(await readFile(join(publicDirectory, "identity.json"), "utf8"));
  if (pin.sha256 !== cert.fingerprint256)
    throw new Error("Existing identity does not match the public pin.");
} else {
  await writeFile(join(publicDirectory, "certificate.crt"), pem, { flag: "wx" });
  await writeFile(
    join(publicDirectory, "identity.json"),
    JSON.stringify(
      {
        commonName: identity,
        sha1: cert.fingerprint.replaceAll(":", ""),
        sha256: cert.fingerprint256,
        validTo: cert.validTo,
        bundleId: "dev.codex-coco.desktop",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
}
console.log(
  "Release identity ready. Private material retained outside the repository; no key rotation performed.",
);
