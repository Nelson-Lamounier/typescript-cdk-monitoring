# Monitoring Infrastructure (AWS CDK)

Production-ready monitoring infrastructure for deploying Prometheus and Grafana on AWS ECS with persistent storage using EFS.

## Features

- **Layered Architecture**: Modular stack design (Networking, EFS, Infrastructure, Services)
- **Persistent Storage**: EFS-backed data persistence for Prometheus and Grafana
- **High Availability**: Multi-AZ deployment with Auto Scaling
- **Cost Optimised**: Environment-specific resource sizing and retention policies
- **Security First**: VPC isolation, security groups, IAM least privilege
- **Automated Configuration**: SSM State Manager for drift correction
- **Comprehensive Testing**: Unit tests with snapshot testing
- **Infrastructure Verification**: Automated validation scripts

## Quick Start

### Prerequisites

- Node.js 18+ and Yarn
- AWS CLI configured with appropriate credentials
- AWS CDK CLI: `npm install -g aws-cdk`

### Installation

```bash
# Install dependencies
make install

# Build TypeScript
make build

# Verify AWS configuration
make check-env
```

### Deployment

```bash
# Deploy all stacks in correct order
make deploy-all

# Verify deployment
make verify-all

# Get ALB DNS to access services
make get-alb-dns
```

Access your services:
- **Prometheus**: `http://<ALB-DNS>:9090`
- **Grafana**: `http://<ALB-DNS>:3000` (default credentials: admin/admin)
  - 4 pre-built dashboards automatically provisioned
  - See [Grafana Dashboards Documentation](docs/GRAFANA_DASHBOARDS.md) for details

## Makefile Commands

This project includes a comprehensive Makefile for common operations. For full documentation, see [Makefile Usage Guide](docs/MAKEFILE_USAGE.md).

### Most Common Commands

```bash
# View all available commands
make help

# Verify infrastructure is ready
make verify-all

# Deploy individual stacks
make deploy-efs          # Deploy EFS stack first
make deploy-infra        # Then Infrastructure
make deploy-service      # Finally Services

# Deploy all stacks in order
make deploy-all

# Show what would change before deploying
make diff

# Run tests
make test

# View logs
make logs-containers
make logs-ecs-agent
```

### Environment Configuration

Override defaults using environment variables:

```bash
# Deploy to staging
make ENVIRONMENT=staging AWS_PROFILE=staging-account deploy-all

# Deploy to production
make ENVIRONMENT=production AWS_PROFILE=prod-account deploy-all
```

## Project Structure

```
monitoring-iac/
├── bin/                      # CDK app entry points
│   ├── app.ts               # Main CDK application
│   └── stacks/              # Stack orchestration
├── lib/
│   ├── stacks/              # CDK stack definitions
│   │   ├── monitoring/      # Monitoring stacks (EFS, Infra, Service)
│   │   └── networking/      # Networking stack (VPC)
│   ├── constructs/          # Reusable CDK constructs
│   │   ├── compute/         # ECS, Lambda, Launch Template
│   │   ├── config/          # SSM Parameters
│   │   ├── networking/      # VPC, ALB, Security Groups
│   │   ├── services/        # Prometheus, Grafana
│   │   └── storage/         # EFS, ECR
│   └── shared/              # Shared utilities and types
│       ├── constants/       # Configuration constants
│       ├── helpers/         # Helper functions
│       ├── types/           # TypeScript type definitions
│       └── utils/           # Validation utilities
├── scripts/
│   └── tests/               # Verification scripts
│       ├── verify-efs-stack.sh       # EFS verification
│       └── verify-infra-stack.sh     # Infrastructure verification
├── tests/                   # Test suites
│   └── unit/                # Unit tests
├── docs/                    # Documentation
├── Makefile                 # Command shortcuts
└── README.md                # This file
```

## Stack Architecture

The infrastructure is organized into four layered stacks:

### 1. Networking Stack
- VPC with public and private subnets
- NAT Gateway for internet access
- VPC Flow Logs
- Foundation for all other stacks

### 2. EFS Stack
- EFS file system for persistent storage
- Mount targets in private subnets
- Access point for controlled access
- SSM parameters for cross-stack references
- Automated YAML configuration generation

### 3. Infrastructure Stack
- ECS cluster with EC2 capacity
- Application Load Balancer
- Auto Scaling Group
- Launch Template with user data
- SSM State Manager associations
- CloudWatch log groups

### 4. Service Stack
- Prometheus ECS task and service
- Grafana ECS task and service
- ALB target groups and routing
- Service discovery
- Auto scaling policies

**Deployment Order**: Networking → EFS → Infrastructure → Service

For detailed architecture documentation, see [bin/stacks/README.md](bin/stacks/README.md).

## Configuration Management

### SSM Parameters

All configuration is stored in SSM Parameter Store:

```
/monitoring/{environment}/
├── infra/config/              # Infrastructure discovery
│   ├── cluster-name
│   ├── cluster-arn
│   ├── alb-dns
│   └── listener-arn
├── efs/config/                # EFS configuration
│   ├── file-system-id
│   ├── access-point-id
│   ├── security-group-id
│   └── availability-zone
└── {service}-config-yaml      # Service configurations
    ├── prometheus-config-yaml
    ├── grafana-datasource-config-yaml
    └── grafana-dashboard-config-yaml
```

### Environment-Specific Configuration

Configure environments in `lib/config/`:
- Resource sizing (CPU, memory, instance types)
- Log retention policies
- Auto scaling settings
- Cost optimisation parameters

## Verification Scripts

Comprehensive bash scripts validate infrastructure deployment:

### EFS Stack Verification
```bash
make verify-efs
```

Checks:
- EFS file system state
- Mount targets availability
- Access point configuration
- SSM Automation Document execution
- Generated configuration files
- Readiness for Infrastructure deployment

### Infrastructure Stack Verification
```bash
make verify-infra
```

Checks:
- ECS cluster and registered instances
- Application Load Balancer status
- EFS mount on instances (actual verification via SSM)
- SSM State Manager associations
- All required SSM parameters
- Readiness for Service deployment

For detailed verification documentation, see [scripts/tests/VERIFICATION_UPDATES.md](scripts/tests/VERIFICATION_UPDATES.md).

## Testing

```bash
# Run all tests
make test

# Run tests in watch mode
make test-watch

# Run tests with coverage
make test-coverage

# Run specific test suite
yarn test tests/unit/stacks/monitoring/
```

Tests include:
- Stack synthesis validation
- Resource configuration verification
- Security best practices (CDK Nag)
- Snapshot testing for complex resources
- Error condition handling

## Development Workflow

### 1. Make Changes
```bash
# Edit TypeScript files
vim lib/stacks/monitoring/infra-stack.ts

# Build
make build
```

### 2. Review Changes
```bash
# See what will change
make diff-infra

# Synthesise CloudFormation
make synth
```

### 3. Test
```bash
# Run tests
make test

# Run linter
make lint
```

### 4. Deploy
```bash
# Deploy specific stack
make deploy-infra

# Verify deployment
make verify-infra
```

### 5. Monitor
```bash
# View logs
make logs-containers

# Get resource information
make get-cluster-name
make get-alb-dns
```

## Troubleshooting

### CloudWatch Agent Configuration Failed

See [docs/CLOUDWATCH_AGENT_FIX.md](docs/CLOUDWATCH_AGENT_FIX.md) for details on the CloudWatch Agent installation and configuration process.

### EFS Not Mounted

```bash
# Verify EFS stack deployed successfully
make verify-efs

# Check EFS mount on instances
INSTANCE_ID="i-xxxxx"
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --instance-ids "$INSTANCE_ID" \
  --parameters 'commands=["df -h /mnt/efs && ls -la /mnt/efs"]' \
  --profile dev-account --region eu-west-1
```

### Service Won't Start

```bash
# Check ECS cluster
make get-cluster-name
aws ecs list-container-instances --cluster <cluster-name>

# Check service status
aws ecs describe-services \
  --cluster <cluster-name> \
  --services prometheus-service grafana-service

# Check task definitions
aws ecs describe-task-definition --task-definition prometheus
```

### SSM Parameters Missing

```bash
# Check if parameters exist
aws ssm get-parameters-by-path \
  --path "/monitoring/development/" \
  --recursive \
  --profile dev-account --region eu-west-1

# Redeploy EFS or Infrastructure stack
make deploy-efs
make deploy-infra
```

## Cost Optimisation

### Environment-Specific Sizing

- **Development**: t3.micro instances, minimal retention
- **Staging**: t3.small instances, moderate retention
- **Production**: t3.medium+ instances, long retention

### Key Cost Factors

1. **NAT Gateway**: ~£30/month (single NAT in non-production)
2. **EFS**: Pay per GB stored + access charges
3. **EC2 Instances**: Based on instance type and count
4. **Application Load Balancer**: ~£20/month + data transfer
5. **CloudWatch Logs**: Based on ingestion and retention

### Cost Reduction Tips

```bash
# Use smaller instance types in development
ENVIRONMENT=development make deploy-infra

# Reduce EFS lifecycle policy
# Edit lib/stacks/monitoring/efs-stack.ts

# Reduce log retention in non-production
# Configured automatically per environment
```

## Security

### Network Security
- Private subnets for compute resources
- Security groups with least privilege
- VPC Flow Logs enabled
- No public internet exposure (ALB in private subnets)

### Access Control
- IAM roles with least privilege
- SSM Session Manager for instance access (no SSH keys)
- EFS access controlled via security groups
- CloudWatch encryption at rest

### Compliance
- CDK Nag suppressions documented
- All security exceptions justified
- Production warnings for configuration issues

## Documentation

- [Makefile Usage Guide](docs/MAKEFILE_USAGE.md) - Complete Makefile documentation
- [Stack Architecture](bin/stacks/README.md) - Detailed stack architecture
- [Verification Updates](scripts/tests/VERIFICATION_UPDATES.md) - Verification script details
- [CloudWatch Agent Fix](docs/CLOUDWATCH_AGENT_FIX.md) - CloudWatch Agent troubleshooting

## Contributing

1. Create a feature branch
2. Make changes and add tests
3. Run tests and linter: `make test && make lint`
4. Verify locally: `make diff`
5. Submit pull request

## License

[Your License Here]

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review verification scripts: `make verify-all`
3. Check CloudWatch logs: `make logs-containers`
4. Review stack events in CloudFormation console
