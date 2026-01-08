/** @format */

import * as ec2 from "aws-cdk-lib/aws-ec2";

import { SubnetConfigurationHelper } from "../../../lib/shared/helpers";

describe("SubnetConfigurationHelper", () => {
  describe("publicSubnet", () => {
    it("should create public subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.publicSubnet();

      expect(config.name).toBe("Public");
      expect(config.subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(config.cidrMask).toBe(24);
      expect(config.mapPublicIpOnLaunch).toBe(true);
      expect(config.tags).toHaveProperty("Type", "Public");
      expect(config.tags).toHaveProperty("Network-Tier", "Public");
    });

    it("should accept custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.publicSubnet(20);

      expect(config.cidrMask).toBe(20);
      expect(config.subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(config.mapPublicIpOnLaunch).toBe(true);
    });

    it("should throw error for invalid CIDR mask (too small)", () => {
      expect(() => SubnetConfigurationHelper.publicSubnet(8)).toThrow(
        "Subnet CIDR mask must be between 16 and 28"
      );
    });

    it("should throw error for invalid CIDR mask (too large)", () => {
      expect(() => SubnetConfigurationHelper.publicSubnet(32)).toThrow(
        "Subnet CIDR mask must be between 16 and 28"
      );
    });

    it("should throw error for non-integer CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.publicSubnet(24.5)).toThrow(
        "Subnet CIDR mask must be an integer"
      );
    });

    it("should accept custom tags", () => {
      const config = SubnetConfigurationHelper.publicSubnet(24, {
        Custom: "Tag",
        Purpose: "LoadBalancers",
      });

      expect(config.tags).toHaveProperty("Type", "Public");
      expect(config.tags).toHaveProperty("Network-Tier", "Public");
      expect(config.tags).toHaveProperty("Custom", "Tag");
      expect(config.tags).toHaveProperty("Purpose", "LoadBalancers");
    });

    it("should merge custom tags with default tags", () => {
      const config = SubnetConfigurationHelper.publicSubnet(24, {
        Type: "CustomType", // Should override default
        Additional: "Value",
      });

      expect(config.tags).toHaveProperty("Type", "CustomType");
      expect(config.tags).toHaveProperty("Network-Tier", "Public");
      expect(config.tags).toHaveProperty("Additional", "Value");
    });
  });

  describe("privateSubnet", () => {
    it("should create private subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.privateSubnet();

      expect(config.name).toBe("Private");
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
      expect(config.cidrMask).toBe(24);
      expect(config.mapPublicIpOnLaunch).toBe(false);
      expect(config.tags).toHaveProperty("Type", "Private");
      expect(config.tags).toHaveProperty("Network-Tier", "Private");
    });

    it("should accept custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.privateSubnet(20);

      expect(config.cidrMask).toBe(20);
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
      // mapPublicIpOnLaunch should not be set for private subnets (CDK doesn't allow it)
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });

    it("should throw error for invalid CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.privateSubnet(8)).toThrow();
      expect(() => SubnetConfigurationHelper.privateSubnet(32)).toThrow();
    });

    it("should accept custom tags", () => {
      const config = SubnetConfigurationHelper.privateSubnet(24, {
        Purpose: "ApplicationServers",
      });

      expect(config.tags).toHaveProperty("Type", "Private");
      expect(config.tags).toHaveProperty("Network-Tier", "Private");
      expect(config.tags).toHaveProperty("Purpose", "ApplicationServers");
    });
  });

  describe("isolatedSubnet", () => {
    it("should create isolated subnet with correct defaults", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet();

      expect(config.name).toBe("Isolated");
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_ISOLATED);
      expect(config.cidrMask).toBe(24);
      // mapPublicIpOnLaunch should not be set for isolated subnets (CDK doesn't allow it)
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
      expect(config.tags).toHaveProperty("Type", "Isolated");
      expect(config.tags).toHaveProperty("Network-Tier", "Isolated");
    });

    it("should accept custom CIDR mask", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet(20);

      expect(config.cidrMask).toBe(20);
      expect(config.subnetType).toBe(ec2.SubnetType.PRIVATE_ISOLATED);
      // mapPublicIpOnLaunch should not be set for isolated subnets (CDK doesn't allow it)
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });

    it("should throw error for invalid CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.isolatedSubnet(8)).toThrow();
      expect(() => SubnetConfigurationHelper.isolatedSubnet(32)).toThrow();
    });

    it("should accept custom tags", () => {
      const config = SubnetConfigurationHelper.isolatedSubnet(24, {
        Purpose: "Databases",
      });

      expect(config.tags).toHaveProperty("Type", "Isolated");
      expect(config.tags).toHaveProperty("Network-Tier", "Isolated");
      expect(config.tags).toHaveProperty("Purpose", "Databases");
      // mapPublicIpOnLaunch should not be set for isolated subnets
      expect(config.mapPublicIpOnLaunch).toBeUndefined();
    });
  });

  describe("twoTierConfiguration", () => {
    it("should create two-tier configuration with default CIDR mask", () => {
      const configs = SubnetConfigurationHelper.twoTierConfiguration();

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("Public");
      expect(configs[0].subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(configs[1].name).toBe("Private");
      expect(configs[1].subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
      expect(configs[0].cidrMask).toBe(24);
      expect(configs[1].cidrMask).toBe(24);
    });

    it("should accept custom CIDR mask for all subnets", () => {
      const configs = SubnetConfigurationHelper.twoTierConfiguration(20);

      expect(configs).toHaveLength(2);
      expect(configs[0].cidrMask).toBe(20);
      expect(configs[1].cidrMask).toBe(20);
    });

    it("should throw error for invalid CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.twoTierConfiguration(8)).toThrow();
      expect(() => SubnetConfigurationHelper.twoTierConfiguration(32)).toThrow();
    });
  });

  describe("threeTierConfiguration", () => {
    it("should create three-tier configuration with default CIDR mask", () => {
      const configs = SubnetConfigurationHelper.threeTierConfiguration();

      expect(configs).toHaveLength(3);
      expect(configs[0].name).toBe("Public");
      expect(configs[0].subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(configs[1].name).toBe("Private");
      expect(configs[1].subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
      expect(configs[2].name).toBe("Isolated");
      expect(configs[2].subnetType).toBe(ec2.SubnetType.PRIVATE_ISOLATED);
      expect(configs[0].cidrMask).toBe(24);
      expect(configs[1].cidrMask).toBe(24);
      expect(configs[2].cidrMask).toBe(24);
    });

    it("should accept custom CIDR mask for all subnets", () => {
      const configs = SubnetConfigurationHelper.threeTierConfiguration(20);

      expect(configs).toHaveLength(3);
      expect(configs[0].cidrMask).toBe(20);
      expect(configs[1].cidrMask).toBe(20);
      expect(configs[2].cidrMask).toBe(20);
    });

    it("should throw error for invalid CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.threeTierConfiguration(8)).toThrow();
      expect(() => SubnetConfigurationHelper.threeTierConfiguration(32)).toThrow();
    });
  });

  describe("eksConfiguration", () => {
    it("should create EKS-tagged subnets with default CIDR masks", () => {
      const configs = SubnetConfigurationHelper.eksConfiguration("my-cluster");

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("Public");
      expect(configs[0].subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(configs[1].name).toBe("Private");
      expect(configs[1].subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);

      // Check Kubernetes tags (use bracket notation for property names with special characters)
      expect(configs[0].tags).toBeDefined();
      if (configs[0].tags) {
        expect(configs[0].tags["kubernetes.io/role/elb"]).toBe("1");
        expect(configs[0].tags["kubernetes.io/cluster/my-cluster"]).toBe("shared");
      }
      expect(configs[1].tags).toBeDefined();
      if (configs[1].tags) {
        expect(configs[1].tags["kubernetes.io/role/internal-elb"]).toBe("1");
        expect(configs[1].tags["kubernetes.io/cluster/my-cluster"]).toBe("shared");
      }
    });

    it("should accept custom CIDR masks", () => {
      const configs = SubnetConfigurationHelper.eksConfiguration("my-cluster", 24, 20);

      expect(configs[0].cidrMask).toBe(24);
      expect(configs[1].cidrMask).toBe(20);
    });

    it("should throw error for empty cluster name", () => {
      expect(() => SubnetConfigurationHelper.eksConfiguration("")).toThrow(
        "EKS cluster name is required for subnet configuration"
      );
    });

    it("should throw error for whitespace-only cluster name", () => {
      expect(() => SubnetConfigurationHelper.eksConfiguration("   ")).toThrow(
        "EKS cluster name is required for subnet configuration"
      );
    });

    it("should include cluster name in Kubernetes tags", () => {
      const clusterName = "production-eks-cluster";
      const configs = SubnetConfigurationHelper.eksConfiguration(clusterName);

      expect(configs[0].tags).toBeDefined();
      if (configs[0].tags) {
        expect(configs[0].tags[`kubernetes.io/cluster/${clusterName}`]).toBe("shared");
      }
      expect(configs[1].tags).toBeDefined();
      if (configs[1].tags) {
        expect(configs[1].tags[`kubernetes.io/cluster/${clusterName}`]).toBe("shared");
      }
    });

    it("should throw error for invalid public CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.eksConfiguration("cluster", 8, 20)).toThrow();
    });

    it("should throw error for invalid private CIDR mask", () => {
      expect(() => SubnetConfigurationHelper.eksConfiguration("cluster", 24, 32)).toThrow();
    });
  });

  describe("costOptimizedConfiguration", () => {
    it("should create cost-optimized configuration with small CIDR masks", () => {
      const configs = SubnetConfigurationHelper.costOptimizedConfiguration();

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("Public");
      expect(configs[1].name).toBe("Private");
      // Should use SMALL recommendation which is 28
      expect(configs[0].cidrMask).toBe(28);
      expect(configs[1].cidrMask).toBe(28);
    });

    it("should have correct subnet types", () => {
      const configs = SubnetConfigurationHelper.costOptimizedConfiguration();

      expect(configs[0].subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(configs[1].subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
    });
  });

  describe("highDensityConfiguration", () => {
    it("should create high-density configuration with large CIDR masks", () => {
      const configs = SubnetConfigurationHelper.highDensityConfiguration();

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("Public");
      expect(configs[1].name).toBe("Private");
      // Should use LARGE recommendation which is 20
      expect(configs[0].cidrMask).toBe(20);
      expect(configs[1].cidrMask).toBe(20);
    });

    it("should have correct subnet types", () => {
      const configs = SubnetConfigurationHelper.highDensityConfiguration();

      expect(configs[0].subnetType).toBe(ec2.SubnetType.PUBLIC);
      expect(configs[1].subnetType).toBe(ec2.SubnetType.PRIVATE_WITH_EGRESS);
    });
  });

  describe("edge cases", () => {
    it("should handle minimum valid CIDR mask (16)", () => {
      const config = SubnetConfigurationHelper.publicSubnet(16);
      expect(config.cidrMask).toBe(16);
    });

    it("should handle maximum valid CIDR mask (28)", () => {
      const config = SubnetConfigurationHelper.publicSubnet(28);
      expect(config.cidrMask).toBe(28);
    });

    it("should handle boundary values in tier configurations", () => {
      const twoTier = SubnetConfigurationHelper.twoTierConfiguration(16);
      expect(twoTier[0].cidrMask).toBe(16);
      expect(twoTier[1].cidrMask).toBe(16);

      const threeTier = SubnetConfigurationHelper.threeTierConfiguration(28);
      expect(threeTier[0].cidrMask).toBe(28);
      expect(threeTier[1].cidrMask).toBe(28);
      expect(threeTier[2].cidrMask).toBe(28);
    });
  });
});
