/** @format */

/**
 * Default CIDR mask for subnets
 * /24 provides 251 usable IP addresses per subnet
 */
export const DEFAULT_SUBNET_CIDR_MASK = 24;

/**
 * Minimum allowed CIDR mask for subnets
 * /16 provides maximum subnet size
 */
export const MIN_SUBNET_CIDR_MASK = 16;

/**
 * Maximum allowed CIDR mask for subnets
 * /28 provides minimum subnet size (11 usable IPs)
 */
export const MAX_SUBNET_CIDR_MASK = 28;

/**
 * Recommended CIDR masks for different use cases
 */
export const SUBNET_CIDR_RECOMMENDATIONS = {
  /**
   * Small workloads, development environments
   * Provides ~11 usable IPs
   */
  SMALL: 28,

  /**
   * Standard workloads, most production environments
   * Provides ~251 usable IPs
   */
  STANDARD: 24,

  /**
   * Large EKS clusters, high-density workloads
   * Provides ~4091 usable IPs
   */
  LARGE: 20,

  /**
   * Very large deployments
   * Provides ~16,379 usable IPs
   */
  EXTRA_LARGE: 18,
} as const;

/**
 * Default VPC CIDR block
 * /16 provides 65,536 IP addresses
 */
export const DEFAULT_VPC_CIDR = "10.0.0.0/16";

/**
 * Default number of availability zones
 */
export const DEFAULT_MAX_AZS = 2;

/**
 * Default number of NAT gateways
 * 0 = no NAT gateways (no internet access for private subnets)
 */
export const DEFAULT_NAT_GATEWAYS = 0;

/**
 * Default VPC Flow Logs retention period (days)
 * 7 days balances cost with basic compliance requirements
 * Production environments should use at least 30 days
 */
export const DEFAULT_FLOW_LOGS_RETENTION_DAYS = 7;

/**
 * Minimum recommended VPC Flow Logs retention for production environments
 * 30 days is the minimum for compliance and security analysis
 */
export const MIN_PRODUCTION_FLOW_LOGS_RETENTION_DAYS = 30;

/**
 * Recommended VPC Flow Logs retention periods for different environments
 */
export const FLOW_LOGS_RETENTION_RECOMMENDATIONS = {
  /**
   * Development environments
   * Short retention for cost optimisation
   */
  DEVELOPMENT: 7,

  /**
   * Staging environments
   * Moderate retention for testing and validation
   */
  STAGING: 30,

  /**
   * Production environments
   * Extended retention for compliance and security analysis
   */
  PRODUCTION: 90,

  /**
   * High-compliance production environments
   * Maximum retention for audit and forensic analysis
   */
  HIGH_COMPLIANCE: 365,
} as const;

/**
 * VPC Peering Lambda handler paths
 */
export const VPC_PEERING_LAMBDA_HANDLERS = {
  /**
   * Lambda handler for creating and accepting VPC peering connections
   */
  CREATE_ACCEPT: "handlers/vpc-peering-create-accept.ts",

  /**
   * Lambda handler for updating route tables in peer VPC
   */
  UPDATE_ROUTES: "handlers/vpc-peering-routes.ts",
} as const;

/**
 * Default Lambda timeout for VPC peering operations (seconds)
 * Peering operations typically complete in seconds, not minutes
 */
export const DEFAULT_VPC_PEERING_LAMBDA_TIMEOUT_SECONDS = 60;

/**
 * Default SSM parameter path prefix for VPC peering connections
 */
export const DEFAULT_VPC_PEERING_SSM_PREFIX = "/vpc-peering";

/**
 * Common network ports for security group rules
 *
 * These constants help avoid magic numbers and improve code readability.
 * Use these when creating security group ingress/egress rules.
 */
export const COMMON_PORTS = {
  /**
   * HTTP - Standard web traffic
   */
  HTTP: 80,

  /**
   * HTTPS - Secure web traffic (TLS/SSL)
   */
  HTTPS: 443,

  /**
   * SSH - Secure shell access
   */
  SSH: 22,

  /**
   * RDP - Remote Desktop Protocol
   */
  RDP: 3389,

  /**
   * MySQL - MySQL database server
   */
  MYSQL: 3306,

  /**
   * PostgreSQL - PostgreSQL database server
   */
  POSTGRESQL: 5432,

  /**
   * MongoDB - MongoDB database server
   */
  MONGODB: 27017,

  /**
   * Redis - Redis cache server
   */
  REDIS: 6379,

  /**
   * Memcached - Memcached cache server
   */
  MEMCACHED: 11211,

  /**
   * SMTP - Simple Mail Transfer Protocol
   */
  SMTP: 25,

  /**
   * SMTP Submission - SMTP submission port
   */
  SMTP_SUBMISSION: 587,

  /**
   * IMAP - Internet Message Access Protocol
   */
  IMAP: 143,

  /**
   * IMAPS - IMAP over SSL
   */
  IMAPS: 993,

  /**
   * POP3 - Post Office Protocol 3
   */
  POP3: 110,

  /**
   * POP3S - POP3 over SSL
   */
  POP3S: 995,

  /**
   * DNS - Domain Name System
   */
  DNS: 53,

  /**
   * NTP - Network Time Protocol
   */
  NTP: 123,

  /**
   * LDAP - Lightweight Directory Access Protocol
   */
  LDAP: 389,

  /**
   * LDAPS - LDAP over SSL
   */
  LDAPS: 636,

  /**
   * FTP - File Transfer Protocol
   */
  FTP: 21,

  /**
   * FTPS - FTP over SSL
   */
  FTPS: 990,

  /**
   * SFTP - SSH File Transfer Protocol
   */
  SFTP: 22, // Same as SSH

  /**
   * Telnet - Telnet protocol (not recommended for security)
   */
  TELNET: 23,

  /**
   * Node Exporter - Prometheus Node Exporter metrics endpoint
   */
  NODE_EXPORTER: 9100,

  /**
   * Prometheus - Prometheus server metrics endpoint
   */
  PROMETHEUS: 9090,

  /**
   * Grafana - Grafana web interface
   */
  GRAFANA: 3000,

  /**
   * Elasticsearch - Elasticsearch HTTP API
   */
  ELASTICSEARCH: 9200,

  /**
   * Kibana - Kibana web interface
   */
  KIBANA: 5601,

  /**
   * Consul - Consul service discovery
   */
  CONSUL: 8500,

  /**
   * Vault - HashiCorp Vault API
   */
  VAULT: 8200,

  /**
   * Nomad - HashiCorp Nomad API
   */
  NOMAD: 4646,

  /**
   * Docker Registry - Docker registry API
   */
  DOCKER_REGISTRY: 5000,

  /**
   * Kubernetes API Server
   */
  KUBERNETES_API: 6443,

  /**
   * Kubernetes Kubelet API
   */
  KUBERNETES_KUBELET: 10250,

  /**
   * Kubernetes etcd client
   */
  KUBERNETES_ETCD_CLIENT: 2379,

  /**
   * Kubernetes etcd peer
   */
  KUBERNETES_ETCD_PEER: 2380,
} as const;

/**
 * Common port ranges for security group rules
 */
export const COMMON_PORT_RANGES = {
  /**
   * Ephemeral port range for Linux (commonly used for outbound connections)
   * Range: 32768-65535
   */
  LINUX_EPHEMERAL: { from: 32768, to: 65535 },

  /**
   * Ephemeral port range for Windows
   * Range: 49152-65535
   */
  WINDOWS_EPHEMERAL: { from: 49152, to: 65535 },

  /**
   * Well-known ports range
   * Range: 0-1023
   */
  WELL_KNOWN: { from: 0, to: 1023 },

  /**
   * Registered ports range
   * Range: 1024-49151
   */
  REGISTERED: { from: 1024, to: 49151 },
} as const;

/**
 * Application Load Balancer default configuration constants
 */

/**
 * Default ALB idle timeout (seconds)
 * 60 seconds is the AWS default and suitable for most web applications
 */
export const DEFAULT_ALB_IDLE_TIMEOUT_SECONDS = 60;

/**
 * Minimum ALB idle timeout (seconds)
 * AWS minimum is 1 second
 */
export const MIN_ALB_IDLE_TIMEOUT_SECONDS = 1;

/**
 * Maximum ALB idle timeout (seconds)
 * AWS maximum is 4000 seconds
 */
export const MAX_ALB_IDLE_TIMEOUT_SECONDS = 4000;

/**
 * Default ALB access log retention period (days)
 * 90 days balances cost with compliance requirements
 * Production environments may require longer retention
 */
export const DEFAULT_ALB_ACCESS_LOG_RETENTION_DAYS = 90;

/**
 * Minimum recommended ALB access log retention for production environments
 * 30 days is the minimum for compliance and security analysis
 */
export const MIN_PRODUCTION_ALB_ACCESS_LOG_RETENTION_DAYS = 30;

/**
 * Default ALB access log transition to Infrequent Access (days)
 * Transition logs to IA after 30 days to reduce storage costs
 */
export const DEFAULT_ALB_ACCESS_LOG_TRANSITION_TO_IA_DAYS = 30;

/**
 * Default ALB access log prefix in S3 bucket
 */
export const DEFAULT_ALB_ACCESS_LOG_PREFIX = "alb-logs";

/**
 * Recommended ALB access log retention periods for different environments
 */
export const ALB_ACCESS_LOG_RETENTION_RECOMMENDATIONS = {
  /**
   * Development environments
   * Short retention for cost optimisation
   */
  DEVELOPMENT: 30,

  /**
   * Staging environments
   * Moderate retention for testing and validation
   */
  STAGING: 60,

  /**
   * Production environments
   * Extended retention for compliance and security analysis
   */
  PRODUCTION: 90,

  /**
   * High-compliance production environments
   * Maximum retention for audit and forensic analysis
   */
  HIGH_COMPLIANCE: 365,
} as const;

/**
 * Application Load Balancer Listener default configuration constants
 */

/**
 * Default HTTP listener port
 */
export const DEFAULT_ALB_HTTP_PORT = 80;

/**
 * Default HTTPS listener port
 */
export const DEFAULT_ALB_HTTPS_PORT = 443;

/**
 * Default fixed response status code for listeners without target groups
 */
export const DEFAULT_ALB_FIXED_RESPONSE_STATUS_CODE = 404;

/**
 * Default fixed response content type
 */
export const DEFAULT_ALB_FIXED_RESPONSE_CONTENT_TYPE = "text/plain";

/**
 * Default fixed response message body
 */
export const DEFAULT_ALB_FIXED_RESPONSE_MESSAGE = "Not Found";
