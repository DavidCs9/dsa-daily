import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { classifyChanges } from "../scripts/classify-changes.mjs";

test("builds a standalone Vite application", async () => {
  const [html, assets] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readdir(new URL("../dist/assets/", import.meta.url)),
  ]);

  assert.match(html, /<title>DSA Daily<\/title>/i);
  assert.match(html, /id="root"/);
  assert.ok(assets.some((name) => name.endsWith(".js")));
  assert.ok(assets.some((name) => name.endsWith(".css")));
});

test("keeps the full cycle and difficulty-based timers", async () => {
  const [problems, app] = await Promise.all([
    readFile(new URL("../src/problems.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal((problems.match(/\{"title":/g) ?? []).length, 150);
  assert.match(problems, /Contains Duplicate/);
  assert.match(problems, /Reverse Integer/);
  assert.match(app, /Easy: 10, Medium: 20, Hard: 30/);
  assert.match(app, /Save &amp; advance/);
});

test("uses private S3 and CloudFront without application compute", async () => {
  const template = await readFile(new URL("../template.yaml", import.meta.url), "utf8");

  assert.match(template, /AWS::S3::Bucket/);
  assert.match(template, /AWS::CloudFront::Distribution/);
  assert.match(template, /AWS::CloudFront::OriginAccessControl/);
  assert.match(template, /BlockPublicAcls: true/);
  assert.doesNotMatch(template, /AWS::Serverless::Function|AWS::Lambda::Function/);
});

test("deploys to AWS only for frontend or application infrastructure changes", () => {
  assert.deepEqual(classifyChanges(["README.md", "tests/app.test.mjs"]), {
    bootstrap: false,
    deploy: false,
    frontend: false,
    infrastructure: false,
  });

  assert.deepEqual(classifyChanges(["src/App.tsx"]), {
    bootstrap: false,
    deploy: true,
    frontend: true,
    infrastructure: false,
  });

  assert.deepEqual(classifyChanges(["template.yaml"]), {
    bootstrap: false,
    deploy: true,
    frontend: false,
    infrastructure: true,
  });

  assert.deepEqual(classifyChanges(["bootstrap/github-release.yaml"]), {
    bootstrap: true,
    deploy: false,
    frontend: false,
    infrastructure: false,
  });
});
