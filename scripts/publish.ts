import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { $ } from "bun";

const PACKAGES_DIR = resolve(import.meta.dir, "../packages");

interface PkgInfo {
  shortName: string;
  name: string;
  version: string;
}

function listPackages(): PkgInfo[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const pkgPath = join(PACKAGES_DIR, d.name, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return { shortName: d.name, name: pkg.name, version: pkg.version };
    });
}

async function publish(shortName: string) {
  const dir = join(PACKAGES_DIR, shortName);
  const pkgPath = join(dir, "package.json");

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    console.log(`发布 ${pkg.name}@${pkg.version} ...`);

    await $`npm publish --access public --workspace ${dir}`.cwd(
      resolve(import.meta.dir, ".."),
    );

    console.log(`完成: ${pkg.name}@${pkg.version}`);
  } catch (err: any) {
    console.error(`发布失败: ${err.message}`);
    process.exit(1);
  }
}

// --- main ---
const arg = process.argv[2];

if (!arg) {
  console.log("用法: bun run scripts/publish.ts <包短名>\n");
  console.log("可用的包:");
  for (const pkg of listPackages()) {
    console.log(`  ${pkg.shortName}  →  ${pkg.name}`);
  }
  process.exit(1);
}

await publish(arg);
