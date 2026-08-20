import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { classifyChanges } from "../scripts/classify-changes.mjs";

test("builds a standalone Vite application", async () => {
  const [html, assets] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readdir(new URL("../dist/assets/", import.meta.url)),
  ]);

  assert.match(html, /<title>DSA Ready<\/title>/i);
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
  assert.match(app, /Save & advance/);
  assert.match(app, /Focused minutes/);
  assert.match(app, /Time not recorded/);
  assert.match(app, /deadlineRef/);
  assert.match(app, /Set next problem/);
  assert.match(app, /Past sessions/);
  assert.match(app, /Activity calendar/);
  assert.match(app, /Best streak/);
  assert.match(app, /completed/);
  assert.match(app, /Next/);
  assert.match(app, /DSA Ready/);
  assert.match(app, /Good work\. The next problem is ready\./);
  assert.match(app, /className="signOutButton"/);
  assert.doesNotMatch(app, />History<\/button>/);
});

test("uses private static hosting and an authenticated serverless persistence API", async () => {
  const [template, handler] = await Promise.all([
    readFile(new URL("../template.yaml", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/handler.ts", import.meta.url), "utf8"),
  ]);

  assert.match(template, /AWS::S3::Bucket/);
  assert.match(template, /AWS::CloudFront::Distribution/);
  assert.match(template, /AWS::CloudFront::OriginAccessControl/);
  assert.match(template, /BlockPublicAcls: true/);
  assert.match(template, /AWS::Serverless::Function/);
  assert.match(template, /AWS::Serverless::HttpApi/);
  assert.match(template, /AWS::DynamoDB::Table/);
  assert.match(template, /DeletionPolicy: RetainExceptOnCreate/);
  assert.match(template, /us-east-2_7LKDrgjB7/);
  assert.match(handler, /@aws-lambda-powertools\/event-handler\/http/);
  assert.match(handler, /app\.patch\("\/v1\/progress"/);
  assert.match(handler, /app\.post\("\/v1\/sessions\/manual"/);
  assert.match(handler, /app\.patch\("\/v1\/sessions\/:cycle\/:problemIndex"/);
  assert.match(handler, /app\.delete\("\/v1\/sessions\/:cycle\/:problemIndex"/);
  assert.match(template, /Method: PATCH/);
  assert.match(template, /Method: DELETE/);
  assert.doesNotMatch(`${template}\n${handler}`, /POWERTOOLS_METRICS_NAMESPACE|@aws-lambda-powertools\/metrics/);
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
