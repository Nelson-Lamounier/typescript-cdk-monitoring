---
name: Bug Report
about: Report a bug in the infrastructure or CI/CD pipeline
title: "[BUG] "
labels: bug
assignees: ''
---

## Bug Description

<!-- A clear and concise description of what the bug is -->

## Environment

- **Environment**: <!-- development / staging / production -->
- **Stack**: <!-- e.g., development-MonitoringService -->
- **AWS Region**: <!-- e.g., eu-west-1 -->
- **CDK Version**: <!-- Run: npx cdk --version -->
- **Node Version**: <!-- Run: node --version -->

## Steps to Reproduce

1. 
2. 
3. 

## Expected Behavior

<!-- What you expected to happen -->

## Actual Behavior

<!-- What actually happened -->

## Error Messages / Logs

<!-- Include any relevant error messages or logs -->

```
Paste error messages here
```

## CloudFormation Events

<!-- If applicable, include relevant CloudFormation events -->

```bash
aws cloudformation describe-stack-events \
  --stack-name <stack-name> \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`]'
```

## Possible Solution

<!-- If you have ideas on how to fix this -->

## Additional Context

<!-- Any other context about the problem -->

## Checklist

- [ ] I have searched existing issues for duplicates
- [ ] I have included all relevant environment information
- [ ] I have included error messages and logs
- [ ] I have tried to reproduce this issue locally
