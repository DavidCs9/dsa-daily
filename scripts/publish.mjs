import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";

const stackName = process.argv[2] ?? "dsa-daily";
const region = process.env.AWS_REGION ?? "us-east-2";

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

accessSync(new URL("../dist/index.html", import.meta.url));

const stack = JSON.parse(run("aws", [
  "cloudformation", "describe-stacks",
  "--stack-name", stackName,
  "--region", region,
  "--output", "json",
], true));
const outputs = Object.fromEntries(
  stack.Stacks[0].Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
);

if (!outputs.SiteBucketName || !outputs.DistributionId) {
  throw new Error("The stack is missing SiteBucketName or DistributionId outputs.");
}

run("aws", [
  "s3", "sync", "dist", `s3://${outputs.SiteBucketName}`,
  "--delete", "--exclude", "index.html", "--exclude", "artifacts/*",
  "--cache-control", "public,max-age=31536000,immutable",
  "--region", region,
]);
run("aws", [
  "s3", "cp", "dist/index.html", `s3://${outputs.SiteBucketName}/index.html`,
  "--cache-control", "no-cache",
  "--content-type", "text/html; charset=utf-8",
  "--region", region,
]);
run("aws", [
  "cloudfront", "create-invalidation",
  "--distribution-id", outputs.DistributionId,
  "--paths", "/*",
]);

console.log(`Published ${outputs.SiteUrl ?? outputs.DistributionUrl}`);
