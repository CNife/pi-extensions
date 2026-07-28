import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { applyLink, planSync, runSync } from "../scripts/sync-personal.mjs";

describe("planSync", () => {
  let root;
  let personal;
  let agent;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-personal-"));
    personal = join(root, "personal");
    agent = join(root, "agent");
    mkdirSync(personal);
    mkdirSync(join(agent, "extensions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("maps top-level .ts to link under extensions/", () => {
    writeFileSync(join(personal, "exit.ts"), "export default () => {}");
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.deepEqual(
      {
        name: plan[0].name,
        type: plan[0].type,
        action: plan[0].action,
        target: plan[0].target,
        installDeps: plan[0].installDeps,
      },
      {
        name: "exit.ts",
        type: "file",
        action: "link",
        target: join(agent, "extensions", "exit.ts"),
        installDeps: undefined,
      },
    );
  });

  it("skips README.md", () => {
    writeFileSync(join(personal, "README.md"), "# hi");
    writeFileSync(join(personal, "exit.ts"), "export default () => {}");
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].name, "exit.ts");
  });

  it("maps package dir to link with installDeps (no settings action)", () => {
    const pkg = join(personal, "advisor-adapter");
    mkdirSync(pkg);
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "personal-advisor-adapter", private: true }),
    );
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, "link");
    assert.equal(plan[0].type, "package");
    assert.equal(plan[0].installDeps, true);
    assert.equal(plan[0].target, join(agent, "extensions", "advisor-adapter"));
    assert.equal(plan[0].settingsSource, undefined);
  });

  it("skips directory without package.json", () => {
    mkdirSync(join(personal, "orphan-config"));
    writeFileSync(join(personal, "orphan-config", "config.json"), "{}");
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, "skip");
    assert.match(plan[0].reason, /without package\.json/);
  });

  it("skips non-ts files", () => {
    writeFileSync(join(personal, "notes.txt"), "x");
    const plan = planSync(personal, agent);
    assert.equal(plan[0].action, "skip");
  });
});

describe("applyLink", () => {
  let root;
  let source;
  let target;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-link-"));
    source = join(root, "exit.ts");
    target = join(root, "extensions", "exit.ts");
    mkdirSync(join(root, "extensions"));
    writeFileSync(source, "export default () => {}");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates symlink", () => {
    const r = applyLink({ name: "exit.ts", source, target });
    assert.equal(r.status, "created");
    assert.ok(lstatSync(target).isSymbolicLink());
  });

  it("is idempotent when already linked", () => {
    applyLink({ name: "exit.ts", source, target });
    const r = applyLink({ name: "exit.ts", source, target });
    assert.equal(r.status, "unchanged");
  });

  it("refuses to overwrite regular file", () => {
    writeFileSync(target, "local-only");
    assert.throws(
      () => applyLink({ name: "exit.ts", source, target }),
      /Refusing to overwrite non-symlink/,
    );
    assert.equal(readFileSync(target, "utf-8"), "local-only");
  });

  it("dry-run does not create symlink", () => {
    const r = applyLink({ name: "exit.ts", source, target }, { dryRun: true });
    assert.equal(r.status, "would-create");
    assert.equal(existsSync(target), false);
  });

  it("links a package directory", () => {
    const pkg = join(root, "advisor-adapter");
    mkdirSync(pkg);
    writeFileSync(join(pkg, "package.json"), "{}");
    const dirTarget = join(root, "extensions", "advisor-adapter");
    const r = applyLink({
      name: "advisor-adapter",
      source: pkg,
      target: dirTarget,
    });
    assert.equal(r.status, "created");
    assert.ok(lstatSync(dirTarget).isSymbolicLink());
  });
});

describe("runSync dry-run", () => {
  let root;
  let personal;
  let agent;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-run-"));
    personal = join(root, "personal");
    agent = join(root, "agent");
    mkdirSync(personal);
    mkdirSync(join(agent, "extensions"), { recursive: true });
    writeFileSync(join(personal, "exit.ts"), "export default () => {}");
    const pkg = join(personal, "advisor-adapter");
    mkdirSync(pkg);
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "personal-advisor-adapter", private: true }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("dry-run does not mutate filesystem or invent settings writes", () => {
    const out = runSync({
      personalDir: personal,
      agentDir: agent,
      dryRun: true,
    });
    assert.equal(out.dryRun, true);
    assert.equal(out.settingsResult, undefined);
    assert.equal(existsSync(join(agent, "extensions", "exit.ts")), false);
    assert.equal(
      existsSync(join(agent, "extensions", "advisor-adapter")),
      false,
    );
    const pkgResult = out.results.find((r) => r.name === "advisor-adapter");
    assert.equal(pkgResult.status, "would-create");
    assert.equal(pkgResult.install.status, "would-npm-install");
  });
});
