<!-- @format -->

# Webapp Stacks

This directory contains AWS CDK stacks for the portfolio webapp application infrastructure.

## Overview

The webapp stacks provision resources for a Next.js portfolio application, including:
- Container registry (ECR)
- Database and storage (DynamoDB + S3)
- Future: Compute infrastructure (ECS/Fargate)
- Future: API Gateway and Lambda functions

## Stack Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Portfolio Application                       │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CDK Webapp Stacks                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. WebappEcrStack        - Container Registry                    │
│ 2. WebappDynamoDbStack   - Database & Storage                    │
│ 3. WebappInfraStack      - Compute Infrastructure (Future)       │
│ 4. WebappServiceStack    - Application Services (Future)         │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Foundation: NetworkingStack                     │
└─────────────────────────────────────────────────────────────────┘
```

## Stacks

### 1. WebappEcrStack

Provisions Amazon ECR repository for Next.js container images.

**Resources:**
- ECR repository with lifecycle policies (keep last 10-20 images)
- Cross-account access for CI/CD pipeline
- Automatic vulnerability scanning on push
- Tag mutability: MUTABLE (dev) / IMMUTABLE (prod)

**Exports:**
- `${environment}-webapp-ecr-repository-uri`
- `${environment}-webapp-ecr-repository-arn`
- `${environment}-webapp-ecr-repository-name`

**Repository URI Format:**
```
<account-id>.dkr.ecr.<region>.amazonaws.com/webapp-webapp-<environment>:<tag>
```

**Dependencies:** None (standalone)

**Files:** 
- Stack: `ecr-stack.ts`
- Construct: `../../constructs/storage/ecr/ecr-construct.ts`

**Documentation:**
- [Complete ECR + Next.js Guide](../../../docs/ECR_NEXTJS_GUIDE.md) - Dockerfile, build, push, CI/CD
- [Quick Reference](../../../docs/ECR_QUICK_REFERENCE.md) - Common commands

---

### 2. WebappDynamoDbStack

Provisions database and storage for portfolio articles and assets.

**Resources:**

#### DynamoDB Articles Table
- **Table Name:** `webapp-articles-${environment}`
- **Primary Key:** `pk` (String) - Format: `ARTICLE#<slug>`
- **Sort Key:** `sk` (String) - Format: `METADATA` | `CONTENT#v<version>`
- **GSI1 (gsi1-status-date):** Query by status and date
  - Partition Key: `gsi1pk` - Format: `STATUS#<status>`
  - Sort Key: `gsi1sk` - Format: `<date>#<slug>`
- **GSI2 (gsi2-tag-date):** Query by tag
  - Partition Key: `gsi2pk` - Format: `TAG#<tag>`
  - Sort Key: `gsi2sk` - Format: `<date>#<slug>`
- **Streams:** Enabled (NEW_AND_OLD_IMAGES) for change data capture
- **Billing:** On-demand (pay-per-request)
- **Encryption:** AWS managed
- **PITR:** Enabled in production only

#### S3 Assets Bucket
- **Bucket Name:** `webapp-article-assets-${environment}`
- **Purpose:** Store article images, diagrams, and media
- **Access:** Private (serve via CloudFront only)
- **Versioning:** Enabled
- **Storage Class:** Intelligent-Tiering (production)
- **Lifecycle:** Auto-delete old versions after 30-90 days
- **CORS:** Configured for Next.js uploads

**Exports:**
- `${environment}-webapp-articles-table-name`
- `${environment}-webapp-articles-table-arn`
- `${environment}-webapp-articles-gsi1-name`
- `${environment}-webapp-articles-gsi2-name`
- `${environment}-webapp-articles-stream-arn`
- `${environment}-webapp-assets-bucket-name`
- `${environment}-webapp-assets-bucket-arn`
- `${environment}-webapp-assets-bucket-domain`

**Dependencies:** None (standalone)

**File:** `dynamodb-stack.ts`

---

## Database Schema Design

### Single-Table Design Pattern

The articles table follows DynamoDB best practices using a single-table design with flexible access patterns.

### Primary Access Patterns

#### 1. Get Article by Slug
```typescript
// Query both metadata and content in parallel
await Promise.all([
  // Get metadata
  dynamoDB.get({
    TableName: 'webapp-articles-development',
    Key: {
      pk: 'ARTICLE#aws-devops-pro-exam',
      sk: 'METADATA'
    }
  }),
  // Get latest content
  dynamoDB.query({
    TableName: 'webapp-articles-development',
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: {
      ':pk': 'ARTICLE#aws-devops-pro-exam',
      ':sk': 'CONTENT#v'
    },
    ScanIndexForward: false,
    Limit: 1
  })
]);
```

#### 2. List Published Articles (Sorted by Date)
```typescript
// Query GSI1 for all published articles
await dynamoDB.query({
  TableName: 'webapp-articles-development',
  IndexName: 'gsi1-status-date',
  KeyConditionExpression: 'gsi1pk = :status',
  ExpressionAttributeValues: {
    ':status': 'STATUS#published'
  },
  ScanIndexForward: false, // Latest first
  Limit: 20
});
```

#### 3. List Articles by Tag
```typescript
// Query GSI2 for articles with specific tag
await dynamoDB.query({
  TableName: 'webapp-articles-development',
  IndexName: 'gsi2-tag-date',
  KeyConditionExpression: 'gsi2pk = :tag',
  ExpressionAttributeValues: {
    ':tag': 'TAG#aws'
  },
  ScanIndexForward: false
});
```

#### 4. Get All Versions of an Article
```typescript
// Query all content versions
await dynamoDB.query({
  TableName: 'webapp-articles-development',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
  ExpressionAttributeValues: {
    ':pk': 'ARTICLE#aws-devops-pro-exam',
    ':sk': 'CONTENT#v'
  },
  ScanIndexForward: false // Latest version first
});
```

### Entity Types

#### Article Metadata Entity
```typescript
{
  // Primary Keys
  pk: "ARTICLE#aws-devops-pro-exam",
  sk: "METADATA",
  entityType: "ARTICLE_METADATA",
  
  // Article Properties
  slug: "aws-devops-pro-exam",
  title: "AWS DevOps Pro Exam Guide",
  description: "Comprehensive guide to passing the AWS DevOps Professional exam",
  author: "Nelson Lamounier",
  date: "2025-01-20",
  
  // Extended Properties
  status: "published", // "draft" | "published" | "archived"
  tags: ["aws", "certification", "devops"],
  category: "AWS Certification",
  readingTimeMinutes: 12,
  featuredImage: "s3://bucket/articles/aws-devops-pro/featured.png",
  
  // Metadata
  createdAt: "2025-01-20T10:00:00Z",
  updatedAt: "2025-01-20T14:30:00Z",
  publishedAt: "2025-01-20T15:00:00Z",
  version: 1,
  
  // GSI Attributes
  gsi1pk: "STATUS#published",
  gsi1sk: "2025-01-20#aws-devops-pro-exam",
  gsi2pk: "TAG#aws", // Denormalised per tag
  gsi2sk: "2025-01-20#aws-devops-pro-exam"
}
```

#### Article Content Entity
```typescript
{
  // Primary Keys
  pk: "ARTICLE#aws-devops-pro-exam",
  sk: "CONTENT#v1",
  entityType: "ARTICLE_CONTENT",
  
  // Content Storage
  contentType: "mdx", // "mdx" | "markdown" | "html"
  content: "# Article content here...",
  
  // For large content (>400KB), store in S3 instead
  contentS3Key: "articles/aws-devops-pro/content-v1.mdx",
  
  // Custom Component Data (ScenarioKeywords, EliminationList, etc.)
  componentData: [
    {
      componentId: "scenario-keywords-1",
      componentType: "ScenarioKeywords",
      position: 1,
      props: {
        keywords: [
          { keyword: "minimize downtime", solution: "Blue/Green deployment" },
          { keyword: "gradual traffic shift", solution: "CodeDeploy canary" }
        ]
      }
    }
  ],
  
  // Image References
  images: [
    {
      id: "spider-method",
      s3Key: "articles/aws-devops-pro/SPIDER_Method.jpeg",
      alt: "Spider method diagram",
      caption: "The SPIDER method for exam questions",
      width: 800,
      height: 600
    }
  ],
  
  // Version Metadata
  version: 1,
  createdAt: "2025-01-20T10:00:00Z",
  changelog: "Initial version"
}
```

### Future Entity Types

The table design supports future extensions without schema changes:

#### Comments
```typescript
{
  pk: "ARTICLE#aws-devops-pro-exam",
  sk: "COMMENT#2025-01-21T10:00:00Z#abc123",
  entityType: "ARTICLE_COMMENT",
  commentId: "abc123",
  authorName: "John Doe",
  authorEmail: "john@example.com",
  content: "Great article!",
  createdAt: "2025-01-21T10:00:00Z"
}
```

#### Analytics/Views
```typescript
{
  pk: "ARTICLE#aws-devops-pro-exam",
  sk: "VIEW#2025-01-21T10:00:00Z",
  entityType: "ARTICLE_VIEW",
  ipAddress: "203.0.113.1",
  userAgent: "Mozilla/5.0...",
  referrer: "https://google.com",
  ttl: 1738579200 // Auto-delete after 90 days
}
```

---

## Cost Estimates

### Monthly Costs (Development Environment)

| Resource | Usage | Cost |
|----------|-------|------|
| DynamoDB Storage (1GB) | Articles + metadata | $0.25/month |
| DynamoDB On-Demand Reads | ~100K requests | $0.025/month |
| DynamoDB On-Demand Writes | ~10K requests | $0.0125/month |
| S3 Storage (1GB) | Images and media | $0.023/month |
| S3 Requests (GET/PUT) | ~10K requests | $0.004/month |
| **Total** | | **~$0.31/month** |

### Monthly Costs (Production Environment)

| Resource | Usage | Cost |
|----------|-------|------|
| DynamoDB Storage (1GB) | Articles + metadata | $0.25/month |
| DynamoDB On-Demand Reads | ~1M requests | $0.25/month |
| DynamoDB On-Demand Writes | ~50K requests | $0.0625/month |
| DynamoDB PITR | ~1GB | $0.05/month (20% of storage) |
| S3 Storage (5GB) | Images and media | $0.115/month |
| S3 Intelligent-Tiering | Auto-optimisation | $0.0025/GB/month |
| CloudFront (10GB transfer) | CDN for images | $0.85/month |
| **Total** | | **~$1.60/month** |

---

## Deployment

### Prerequisites

1. Networking stack must be deployed first
2. Environment variables configured (see `config/environments.ts`)
3. AWS credentials configured with appropriate permissions

### Deploy All Webapp Stacks

```bash
# Development environment
PROJECT_NAME=webapp ENVIRONMENT=development cdk deploy --all

# Staging environment
PROJECT_NAME=webapp ENVIRONMENT=staging cdk deploy --all

# Production environment (requires approval)
PROJECT_NAME=webapp ENVIRONMENT=production cdk deploy --all
```

### Deploy Specific Stack

```bash
# ECR stack only
PROJECT_NAME=webapp ENVIRONMENT=development cdk deploy development-WebappEcr

# DynamoDB stack only
PROJECT_NAME=webapp ENVIRONMENT=development cdk deploy development-WebappDynamoDb
```

### Deployment Order

Stacks can be deployed in parallel (no dependencies between webapp stacks):

1. NetworkingStack (foundation)
2. WebappEcrStack + WebappDynamoDbStack (parallel)
3. Future stacks will depend on the above

---

## Integration with Next.js Portfolio

### Environment Variables

Configure in your Next.js application (`.env.local`):

```bash
# DynamoDB Configuration
DYNAMODB_TABLE_NAME=webapp-articles-development
DYNAMODB_GSI1_NAME=gsi1-status-date
DYNAMODB_GSI2_NAME=gsi2-tag-date
AWS_REGION=eu-west-1

# S3 Configuration
S3_ASSETS_BUCKET=webapp-article-assets-development
CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net

# API Configuration (when Lambda is deployed)
NEXT_PUBLIC_API_URL=https://api.yourportfolio.com
```

### Data Migration

See `DYNAMODB_ARTICLES_MIGRATION.md` in the repository root for:
- Migration script usage
- MDX to DynamoDB conversion
- Image upload to S3
- Content transformation

### API Integration

The Next.js application will fetch articles via:

**Option A:** Direct SDK (SSR/SSG)
```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getArticleBySlug(slug: string) {
  const result = await client.send(new GetCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME,
    Key: {
      pk: `ARTICLE#${slug}`,
      sk: 'METADATA'
    }
  }));
  
  return result.Item;
}
```

**Option B:** API Gateway + Lambda (Recommended)
```typescript
export async function getArticleBySlug(slug: string) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/articles/${slug}`
  );
  return response.json();
}
```

---

## Security Considerations

### DynamoDB Access

- **Least Privilege IAM:** Lambda functions have read-only access by default
- **Admin Access:** Separate IAM role for content management
- **VPC Endpoints:** Use VPC endpoints to avoid internet traffic (optional)
- **Encryption:** AWS managed encryption (upgrade to KMS if compliance requires)

### S3 Access

- **Block Public Access:** All public access blocked
- **CloudFront Only:** Serve images via CloudFront OAI/OAC
- **Pre-signed URLs:** For temporary upload access from Next.js
- **CORS Configuration:** Restricts origins to portfolio domain + dev environments

### Data Validation

- **Content Sanitization:** Sanitize MDX content before storage
- **Schema Validation:** Validate entity structure in Lambda
- **Rate Limiting:** Apply rate limits in API Gateway
- **Input Validation:** Validate all query parameters

---

## Monitoring and Observability

### CloudWatch Metrics

**DynamoDB:**
- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits`
- `SystemErrors`
- `UserErrors`
- `ThrottledRequests`

**S3:**
- `BucketSizeBytes`
- `NumberOfObjects`
- `AllRequests`
- `4xxErrors`
- `5xxErrors`

### CloudWatch Alarms (Production)

- DynamoDB throttling events
- S3 4xx/5xx error rates
- Lambda invocation errors (when deployed)
- API Gateway latency (when deployed)

### DynamoDB Streams

Enabled for change data capture:
- Trigger Lambda on article publish/update
- Sync to OpenSearch for full-text search (future)
- Analytics pipeline (future)
- Audit logging (future)

---

## Troubleshooting

### Issue: DynamoDB Table Creation Fails

**Symptoms:** Stack deployment fails with "Resource already exists"

**Solution:**
```bash
# Check if table exists
aws dynamodb describe-table \
  --table-name webapp-articles-development \
  --region eu-west-1

# If table exists from previous deployment, either:
# 1. Delete manually (if safe)
aws dynamodb delete-table \
  --table-name webapp-articles-development \
  --region eu-west-1

# 2. Import existing table to CDK stack
cdk import development-WebappDynamoDb
```

### Issue: S3 Bucket Creation Fails

**Symptoms:** "Bucket name already exists globally"

**Solution:**
```bash
# S3 bucket names must be globally unique
# Update bucket name in stack to be more unique:
# From: webapp-article-assets-development
# To: webapp-article-assets-development-<account-id>
```

### Issue: GSI Backfill Takes Too Long

**Symptoms:** Stack deployment timeout when adding GSI to existing table

**Solution:**
- GSI creation on existing tables can take time (scans all items)
- Increase CDK timeout: `--timeout 60` (60 minutes)
- Or add GSI manually and import state:
```bash
aws dynamodb update-table \
  --table-name webapp-articles-development \
  --attribute-definitions \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
  --global-secondary-index-updates \
    '[{"Create":{"IndexName":"gsi1-status-date",...}}]'
```

### Issue: CORS Errors When Uploading Images

**Symptoms:** Browser shows CORS error when uploading to S3

**Solution:**
1. Verify CORS configuration in S3 bucket
2. Ensure origin matches exactly (no trailing slash)
3. Check CloudFront distribution CORS headers
4. Use pre-signed URLs for uploads instead of direct S3 access

---

## Next Steps

1. **Deploy Infrastructure:**
   ```bash
   PROJECT_NAME=webapp ENVIRONMENT=development cdk deploy --all
   ```

2. **Migrate Existing Articles:**
   ```bash
   # From portfolio Next.js repository
   yarn migrate:articles:dry-run  # Preview
   yarn migrate:articles          # Execute
   ```

3. **Deploy API Layer (Future):**
   - Lambda functions for CRUD operations
   - API Gateway with authentication
   - CloudFront distribution for CDN

4. **Integrate with Next.js:**
   - Update article fetching logic
   - Configure environment variables
   - Test with migrated data

5. **Add Search (Future):**
   - OpenSearch domain for full-text search
   - Lambda function to sync DynamoDB → OpenSearch
   - Search API endpoint

6. **Add Analytics (Future):**
   - Track article views
   - Popular articles dashboard
   - Reading time analytics

---

## Related Documentation

- [DynamoDB Articles Migration Guide](../../../DYNAMODB_ARTICLES_MIGRATION.md)
- [DynamoDB Table Construct](../../constructs/storage/dynamodb/dynamodb-table-construct.ts)
- [S3 Bucket Construct](../../constructs/storage/s3/s3-bucket-construct.ts)
- [Project Configuration](../../../config/projects.ts)
- [Environment Configuration](../../../config/environments.ts)

---

*Last Updated: January 2026*
