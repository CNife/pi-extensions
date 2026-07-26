import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  planSync,
  updateSettingsPackages,
  applyLink,
  applySettingsMutation,
  assertNoStandalonePackageExtension,
  DEFAULT_REMOVE_SOURCES,
} from "../scripts/sync-personal.mjs";

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

  it("maps top-level .ts to link action under extensions/", () => {
    writeFileSync(join(personal, "exit.ts"), "export default () => {}");
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.deepEqual(
      {
        name: plan[0].name,
        type: plan[0].type,
        action: plan[0].action,
        target: plan[0].target,
      },
      {
        name: "exit.ts",
        type: "file",
        action: "link",
        target: join(agent, "extensions", "exit.ts"),
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

  it("maps directory with package.json to install-local (no link)", () => {
    const pkg = join(personal, "advisor-adapter");
    mkdirSync(pkg);
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "personal-advisor-adapter", private: true }),
    );
    const plan = planSync(personal, agent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, "install-local");
    assert.equal(plan[0].type, "package");
    assert.equal(plan[0].settingsSource, pkg);
    assert.equal(plan[0].target, undefined);
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

describe("updateSettingsPackages", () => {
  it("adds absolute local path, dedupes, removes advisor and miscs sources", () => {
    const local = "/home/me/code/pi-extensions/personal/advisor-adapter";
    const settings = {
      packages: [
        "npm:@cnife/pi-nmem",
        "npm:@juicesharp/rpiv-advisor",
        "npm:@cnife/pi-miscs",
        local,
      ],
    };
    const next = updateSettingsPackages(settings, {
      add: [local],
      remove: DEFAULT_REMOVE_SOURCES,
    });
    assert.deepEqual(next.packages, ["npm:@cnife/pi-nmem", local]);
  });

  it("preserves object-form package entries when not removed", () => {
    const settings = {
      packages: [{ source: "npm:foo", extensions: ["a.ts"] }, "npm:bar"],
    };
    const next = updateSettingsPackages(settings, {
      add: ["/abs/pkg"],
      remove: ["npm:bar"],
    });
    assert.deepEqual(next.packages, [
      { source: "npm:foo", extensions: ["a.ts"] },
      "/abs/pkg",
    ]);
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
});

describe("applySettingsMutation", () => {
  let root;
  let settingsPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-settings-"));
    settingsPath = join(root, "settings.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          packages: ["npm:@cnife/pi-nmem", "npm:@cnife/pi-miscs"],
        },
        null,
        2,
      )}\n`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("updates packages and writes bak-sync once", () => {
    const local = "/tmp/personal/advisor-adapter";
    const r = applySettingsMutation(settingsPath, {
      add: [local],
      remove: DEFAULT_REMOVE_SOURCES,
    });
    assert.equal(r.status, "updated");
    const next = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(next.packages, ["npm:@cnife/pi-nmem", local]);
    assert.ok(existsSync(`${settingsPath}.bak-sync`));
  });

  it("dry-run does not write", () => {
    const before = readFileSync(settingsPath, "utf-8");
    const r = applySettingsMutation(
      settingsPath,
      { add: ["/x"], remove: [] },
      { dryRun: true },
    );
    assert.equal(r.status, "would-update");
    assert.equal(readFileSync(settingsPath, "utf-8"), before);
    assert.equal(existsSync(`${settingsPath}.bak-sync`), false);
  });
});

describe("assertNoStandalonePackageExtension", () => {
  let root;
  let agent;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sync-standalone-"));
    agent = root;
    mkdirSync(join(agent, "extensions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when absent", () => {
    assert.doesNotThrow(() =>
      assertNoStandalonePackageExtension(agent, "advisor-adapter"),
    );
  });

  it("throws when regular file present", () => {
    writeFileSync(join(agent, "extensions", "advisor-adapter.ts"), "// old");
    assert.throws(
      () => assertNoStandalonePackageExtension(agent, "advisor-adapter"),
      /old standalone extension/,
    );
  });
});
