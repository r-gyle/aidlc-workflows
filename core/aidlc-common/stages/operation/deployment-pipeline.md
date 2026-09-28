---
slug: deployment-pipeline
phase: operation
execution: CONDITIONAL
condition: Execute when CD pipeline needs creation or significant modification
lead_agent: aidlc-pipeline-deploy-agent
support_agents: []
mode: inline
summary_confirmation: required
produces:
  - cd-config
  - deployment-strategy
  - rollback-runbook
  - deployment-pipeline-questions
consumes:
  - artifact: ci-config
    required: true
  - artifact: quality-gates
    required: true
  - artifact: infrastructure-specification
    required: true
  - artifact: cicd-pipeline
    required: true
requires_stage:
  - ci-pipeline
  - infrastructure-design
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
  - infra
  - bugfix
  - refactor
  - security-patch
  - workshop
  - express
inputs: CI pipeline config from ci-pipeline stage, infrastructure design from infrastructure-design stage
outputs: cd-config.md, deployment-strategy.md, rollback-runbook.md, deployment-pipeline-questions.md (under this stage's record dir, engine-resolved)
---

# Deployment Pipeline Configuration

## Steps

### Step 1: Load Prior Context

- Read CI pipeline config from `<record>/construction/ci-pipeline/` (if exists)
- Read infrastructure design from `<record>/construction/infrastructure-design/` (if exists)
- Read NFR design (deployment-related NFRs) from `<record>/construction/nfr-design/` (if exists)

Incremental scopes (`bugfix`, `refactor`, and `security-patch`) and `express`
skip CI Pipeline and Infrastructure Design by design. On brownfield, inspect
the workspace's existing pipeline and infrastructure configuration plus the
code knowledge base. On Express greenfield, use the approved requirements,
Build and Test results, and deployment artifacts generated in the workspace.
Design only against evidence that exists - never invent a missing CI or
infrastructure artifact.

#### Applicability check (every scope, before any question)

A **deployable target** is an active definition of how this project ships: a
CD workflow or pipeline file that is not disabled or wholly commented out,
infrastructure as code (CDK, CloudFormation, SAM, Terraform, Serverless), or a
deployment manifest (a service or orchestration manifest, Kubernetes
manifests, or a hosting platform's deploy file). A Dockerfile or build script
on its own is not a target. Decide from that evidence before Step 2:

| Evidence | Scope | Action |
|---|---|---|
| Active target, and the approved requirements need no change to how it ships | any | Report skipped: the existing pipeline is adequate, and Deployment Execution deploys through it |
| No target | `bugfix`, `refactor`, `express` | Report skipped: the change did not ask for delivery infrastructure |
| No target | `security-patch` | Ask the question below: the patch must still reach production |
| No target | any other scope | Continue to Step 2 only when the approved requirements or scope include deploying; otherwise ask the question below |
| Ambiguous: a disabled or commented-out pipeline, or deploy scripts with no clear target | any | Ask the question below |
| Anything else | any | Continue to Step 2 |

To report skipped, name what you checked and found in the reason, because
Deployment Execution reads it:

```bash
{{INVOKE}} engine orchestrate report --stage deployment-pipeline --result skipped --reason "<evidence checked and why this stage does not apply>"
```

When the table says to ask, record the prompt with
`{{INVOKE}} engine log decision --stage deployment-pipeline --decision "<what was and was not found>" --options "Skip deployment for this change,Set up deployment"`,
present this structured question, and end the turn:

```question
prompt: "<One sentence naming the deployment evidence found or missing.> How should this change handle deployment?"
header: Deployment
multiSelect: false
options:
  - label: Skip deployment for this change
    description: It ships outside this workflow, or does not need to ship
  - label: Set up deployment
    description: Design a deployment pipeline as part of this workflow
```

After the human answers, record
`{{INVOKE}} engine log answer --stage deployment-pipeline --details "<exact choice>"`.
On **Skip deployment for this change**, report skipped and include the human's
choice in the reason. On **Set up deployment**, continue to Step 2.

### Step 2: Generate Clarifying Questions

Create questions file covering:
- What deployment strategy (blue/green, canary, rolling)?
- What environment promotion gates (dev → staging → prod)?
- What approval workflows for production?
- What rollback procedure?
- What feature flag strategy (CloudWatch Evidently, AppConfig)?

Follow stage-protocol.md question flow.

### Step 3: Generate Artifacts

Create CD pipeline configuration, deployment strategy document, rollback runbook, feature flag configuration, and environment promotion matrix.

### Step 4: Completion Handoff

Hand completion to `stage-protocol.md` via
`{{INVOKE}} engine orchestrate report --stage deployment-pipeline --result <outcome>`.
That `report` call owns every lifecycle transition and advancement; never perform one in prose, and never narrate this bookkeeping to the user.

### Step 5: Present Completion & Request Approval

Completion emoji: :rocket:
Review path: `<record>/operation/deployment-pipeline/`
Standard 2-option approval (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/operation/deployment-pipeline/`.

Imports: `required-sections`, `upstream-coverage`.

Upstream targets: `ci-config`, `quality-gates`, `infrastructure-specification`, `cicd-pipeline`.

## Learn

When `directive.protocol_modules` lists `learnings`, follow
`stage-protocol-learnings.md`: keep the diary at `directive.memory_path` while
working and run the ritual before the approval gate, applying its bootstrap,
`single: true`, per-unit, and gate-revision exemptions. When the module is absent,
skip both the diary and the ritual.
