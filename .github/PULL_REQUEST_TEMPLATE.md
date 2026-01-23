## Summary

<!-- Briefly describe what this PR does -->

## Type of Change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Infrastructure change (CDK stacks, constructs, or resources)
- [ ] Documentation update
- [ ] CI/CD change (workflows, actions)
- [ ] Refactoring (no functional changes)

## Changes Made

<!-- List the main changes -->

-
-
-

## Infrastructure Impact

<!-- If this PR affects infrastructure, complete this section -->

### Stacks Affected

- [ ] Networking
- [ ] S3
- [ ] EFS
- [ ] Infrastructure (ECS, ALB)
- [ ] Service (Prometheus, Grafana)
- [ ] Security (Prowler)
- [ ] Webapp (API Gateway, Lambda, DynamoDB)
- [ ] None

### Environment(s) Affected

- [ ] Development
- [ ] Staging
- [ ] Production
- [ ] All

### Resource Changes

<!-- Describe any resources being created, modified, or deleted -->

| Resource Type | Action | Notes |
|---------------|--------|-------|
| | | |

## Testing

<!-- Describe how you tested these changes -->

### Local Testing

- [ ] Ran `yarn build` successfully
- [ ] Ran `yarn lint` with no errors
- [ ] Ran `yarn test` with passing tests
- [ ] Ran `npx cdk synth` successfully
- [ ] Ran `npx cdk diff` and reviewed changes

### Deployment Testing

- [ ] Deployed to development environment
- [ ] Verified deployment with verification scripts
- [ ] Tested functionality manually

## Checklist

<!-- Ensure all items are completed -->

- [ ] My code follows the project's coding standards
- [ ] I have updated documentation as needed
- [ ] I have added tests for new functionality
- [ ] All existing tests pass
- [ ] CDK Nag has no new suppressions (or suppressions are documented)
- [ ] Security implications have been considered
- [ ] This change does not expose secrets or sensitive data

## Rollback Plan

<!-- How to rollback if something goes wrong -->

```bash
# Example rollback commands
npx cdk deploy development-<previous-version>
# or
make rollback ENVIRONMENT=development STACK=<stack-name>
```

## Related Issues

<!-- Link any related issues -->

Closes #
Related to #

## Screenshots / Logs

<!-- Add any relevant screenshots or log outputs -->

## Additional Notes

<!-- Any additional context or notes for reviewers -->
