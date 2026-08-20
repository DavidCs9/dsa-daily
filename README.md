# DSA Ready

A low-friction NeetCode 150 practice loop: open the next problem, work against a difficulty-based timer, record the outcome, and advance automatically.

## Local development

```bash
npm install
npm install --prefix backend
npm run dev
```

The Vite development server runs at `http://localhost:3000`.

Local sign-in and API calls require these build-time variables from the `dsa-daily` stack outputs:

```bash
export VITE_API_URL="https://example.execute-api.us-east-2.amazonaws.com"
export VITE_COGNITO_USER_POOL_ID="us-east-2_7LKDrgjB7"
export VITE_COGNITO_USER_POOL_CLIENT_ID="your-dsa-spa-client-id"
```

## Timers

- Easy: 10 minutes
- Medium: 20 minutes
- Hard: 30 minutes

Progress is stored in DynamoDB and follows the signed-in Cognito user across devices. Existing browser progress is imported once when the account has no server-side state.

## AWS architecture

```text
Route 53 (optional custom domain)
             ↓
        CloudFront
             ↓ OAC
       Private S3 bucket

Browser → shared Cognito user pool
        → HTTP API (JWT authorizer)
        → Powertools Event Handler Lambda
        → DynamoDB
```

The application stack deploys to `us-east-2` and reuses Cognito user pool `us-east-2_7LKDrgjB7`. It creates a DSA-specific public SPA client without a secret and does not modify or own the shared pool. If a custom domain is enabled, its CloudFront ACM certificate must be in `us-east-1`.

The DynamoDB table uses on-demand capacity, encryption, point-in-time recovery, and retain policies. There are no custom application metrics or dashboards; the API keeps structured logs and X-Ray traces for troubleshooting.

## AWS local access

Local AWS access uses the saved `decs-admin` login profile:

- Account: `225989371926`
- Principal: `arn:aws:iam::225989371926:user/decs-admin`
- Default region: `us-east-2`

Start or renew the session when AWS asks you to authenticate:

```bash
aws login --profile decs-admin --region us-east-2
export AWS_PROFILE=decs-admin
aws sts get-caller-identity
```

The short-lived credentials rotate automatically every 15 minutes. The overall login session remains valid for up to 12 hours, so do not run `aws login` again while the current session still works. Tokens stay in the local AWS login cache and must never be committed to the repository.

## Deploy

Authenticate first, then run:

```bash
npm run infra:validate
npm run deploy
```

The deploy command builds the Vite app, applies `template.yaml` with SAM, uploads `dist/` to the stack's private bucket, and invalidates CloudFront. The GitHub workflow packages Lambda artifacts under the bucket's `artifacts/` prefix, which static publishing preserves.

## GitHub release workflow

Pull requests to `main` run the complete test, build, lint, and infrastructure validation gate. On a merge to `main`, the workflow classifies the changed files before requesting AWS credentials:

- Frontend and build-input changes publish a fresh Vite build to S3 and invalidate CloudFront.
- Application infrastructure changes deploy CloudFormation, then rebuild and publish the frontend.
- Documentation, tests, lint configuration, and workflow-only changes skip AWS deployment.
- Bootstrap-role changes are reported separately because the application release role cannot safely update itself.

Add a repository variable named `AWS_DEPLOY_ROLE_ARN` containing the ARN of the AWS role trusted by this repository's `main` branch. No long-lived AWS access keys are stored in GitHub. Until the variable exists, the deployment job is intentionally skipped while pull-request checks continue to work.

The production URL is `https://dsa.castrodavid.dev`. The deployment values are recorded in `samconfig.toml`:

- `EnableCustomDomain="true"`
- `AppDomainName`
- `CertificateArn`
- `HostedZoneId`
- `WebOrigin="https://dsa.castrodavid.dev"`
- `ExistingUserPoolId="us-east-2_7LKDrgjB7"`

The reproducible `bootstrap/github-release.yaml` stack creates the CloudFront certificate and the GitHub OIDC role. The role trusts only this repository's protected `main` branch and is exposed to the workflow through repository variables.

## Useful commands

- `npm run build` — type-check and build the static app
- `npm test` — verify the app and infrastructure shape
- `npm run lint` — lint the project
- `npm run infra:validate` — validate the SAM/CloudFormation template
- `npm run publish` — upload a new build to an existing stack
- `npm run build --prefix backend` — type-check the Lambda
- `npm test --prefix backend` — test progression and API-boundary rules
