/** @format */

// ========================================================================
// TYPES
// ========================================================================
// ARTICLE METADATA
// ========================================================================
export interface ArticleMetadata {
  pk: string;
  sk: string;
  entityType: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  date: string;
  status: "draft" | "published" | "archived";
  tags: string[];
  category: string;
  readingTimeMinutes: number;
  featuredImage?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  version: number;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk?: string;
  gsi2sk?: string;
}

// ========================================================================
// ARTICLE CONTENT
// ========================================================================
export interface ArticleContent {
  pk: string;
  sk: string;
  entityType: string;
  contentType: "mdx" | "markdown" | "html";
  content: string;
  contentS3Key?: string;
  componentData?: Array<{
    componentId: string;
    componentType: string;
    position: number;
    props: Record<string, unknown>;
  }>;
  images: Array<{
    id: string;
    s3Key: string;
    alt: string;
    caption?: string;
    width?: number;
    height?: number;
  }>;
  version: number;
  createdAt: string;
  changelog?: string;
}

// ========================================================================
// ARTICLE RESPONSE
// ========================================================================
export interface ArticleResponse {
  metadata: ArticleMetadata;
  content: ArticleContent;
}

// ========================================================================
// LIST ARTICLES BY TAG RESPONSE
// ========================================================================
export interface ListArticlesByTagResponse {
  tag: string;
  articles: ArticleMetadata[];
  nextToken?: string;
  count: number;
}

// ========================================================================
// LIST ARTICLES RESPONSE
// ========================================================================
export interface ListArticlesResponse {
  articles: ArticleMetadata[];
  nextToken?: string;
  count: number;
}
