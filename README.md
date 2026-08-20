# DSA Daily

A low-friction NeetCode 150 practice loop: open the next problem, work against a difficulty-based timer, record the outcome, and advance automatically.

## Local development

```bash
npm install
npm run dev
```

The Vite development server runs at `http://localhost:3000`.

## Timers

- Easy: 10 minutes
- Medium: 20 minutes
- Hard: 30 minutes

Progress is currently stored in the browser. The SAM template is ready for future Lambda and DynamoDB backend resources without changing the frontend hosting model.

## AWS architecture

The initial stack contains no application compute:

```text
Route 53 (optional custom domain)
             ↓
        CloudFront
             ↓ OAC
       Private S3 bucket
```

The stack deploys to `us-east-2`. If a custom domain is enabled, its CloudFront ACM certificate must be in `us-east-1`.

## Deploy

Authenticate first, then run:

```bash
npm run infra:validate
npm run deploy
```

The deploy command builds the Vite app, applies `template.yaml` with SAM, uploads `dist/` to the stack's private bucket, and invalidates CloudFront.

## GitHub release workflow

Pull requests to `main` run the complete test, build, lint, and infrastructure validation gate. A merge to `main` repeats the gate and then deploys through AWS OIDC.

Add a repository variable named `AWS_DEPLOY_ROLE_ARN` containing the ARN of the AWS role trusted by this repository's `main` branch. No long-lived AWS access keys are stored in GitHub. Until the variable exists, the deployment job is intentionally skipped while pull-request checks continue to work.

The production URL is `https://dsa.castrodavid.dev`. The deployment values are recorded in `samconfig.toml`:

- `EnableCustomDomain="true"`
- `AppDomainName`
- `CertificateArn`
- `HostedZoneId`

The reproducible `bootstrap/github-release.yaml` stack creates the CloudFront certificate and the GitHub OIDC role. The role trusts only this repository's protected `main` branch and is exposed to the workflow through repository variables.

## Useful commands

- `npm run build` — type-check and build the static app
- `npm test` — verify the app and infrastructure shape
- `npm run lint` — lint the project
- `npm run infra:validate` — validate the SAM/CloudFormation template
- `npm run publish` — upload a new build to an existing stack
