import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const frontendFiles = new Set([
  "index.html",
  "package-lock.json",
  "package.json",
  "scripts/publish.mjs",
  "tsconfig.json",
  "vite.config.ts",
]);

const infrastructureFiles = new Set(["samconfig.toml", "template.yaml"]);

export function classifyChanges(files) {
  const frontend = files.some(
    (file) =>
      frontendFiles.has(file) ||
      file.startsWith("public/") ||
      file.startsWith("src/"),
  );
  const infrastructure = files.some(
    (file) =>
      infrastructureFiles.has(file) ||
      file.startsWith("backend/") ||
      file.startsWith("functions/") ||
      file.startsWith("layers/"),
  );
  const bootstrap = files.some((file) => file.startsWith("bootstrap/"));

  return {
    bootstrap,
    deploy: frontend || infrastructure,
    frontend,
    infrastructure,
  };
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function writeGitHubResults(result, files) {
  if (process.env.GITHUB_OUTPUT) {
    const outputs = Object.entries(result)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n");
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputs}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const changedFiles = files.length
      ? files.map((file) => `- \`${file}\``).join("\n")
      : "- No changed files detected";
    const bootstrapNote = result.bootstrap
      ? "\n> Bootstrap infrastructure changed. Review it separately; the application release role cannot update itself.\n"
      : "";

    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Release decision\n\n| Target | Changed |\n| --- | --- |\n| Frontend | ${yesNo(result.frontend)} |\n| Application infrastructure | ${yesNo(result.infrastructure)} |\n| Bootstrap infrastructure | ${yesNo(result.bootstrap)} |\n| Deploy to AWS | ${yesNo(result.deploy)} |\n${bootstrapNote}\n### Changed files\n\n${changedFiles}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  const result = classifyChanges(files);
  writeGitHubResults(result, files);
  console.log(JSON.stringify(result));
}
