## Grafana Service

This directory contains the Grafana service construct and supporting helpers.

- `grafana-service-construct.ts`: Orchestrates ECS/EFS resources and wiring (EC2 or Fargate, optional ALB target, logging, scaling).
- `grafana-config-builder.ts`: Builds Grafana environment variables, datasource provisioning YAML, dashboard provisioning YAML, and helper builders for CloudWatch/Prometheus datasources plus OAuth/SMTP environment values.
- `grafana-dashboard-config.ts`: Placeholder for pre-built dashboard JSON templates.

### Responsibilities
- **Construct**: Infra orchestration (task/service, storage, networking, logging, scaling).
- **Config builder**: Generates application configuration (env vars, provisioning files, plugins) to keep the construct focused on infrastructure.
