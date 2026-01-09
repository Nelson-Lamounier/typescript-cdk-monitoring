<!-- @format -->

# Construct Architecture Review

## Executive Summary

This review identifies several architectural issues with construct organisation, including duplicate constructs, incorrect file placement, and constructs that should be split or consolidated.

---

## Critical Issues

### 1. Duplicate VPC Constructs ❌

**Problem**: Three different VPC constructs exist in different locations:

1. `lib/constructs/networking/vpc-construct.ts` - Simple version (lines 1-36)
2. `lib/constructs/networking/vpc/vpc-construct.ts` - Enhanced version (lines 1-144)
3. `lib/stacks/networking-stack.ts` - Inline VpcConstruct (lines 179-311)

**Impact**:

- Confusion about which construct to use
- Potential inconsistencies in VPC creation
- Maintenance burden (changes need to be applied in multiple places)

**Recommendation**:

- ✅ **Keep**: `lib/constructs/networking/vpc/vpc-construct.ts` (most complete)
- ❌ **Remove**: `lib/constructs/networking/vpc-construct.ts` (duplicate, less features)
- ❌ **Refactor**: Remove inline `VpcConstruct` from `networking-stack.ts` and import from constructs

**Action**: Consolidate to single source of truth in `lib/constructs/networking/vpc/vpc-construct.ts`

---

### 2. Duplicate Lambda Function Construct ❌

**Problem**: Lambda construct exists in two locations:

1. `lib/constructs/compute/lambda/lambda-function-construct.ts` (195 lines) - ✅ Proper location
2. `lib/stacks/compute/lambda-stack.ts` (195 lines) - ❌ Wrong location (should be in constructs)

**Impact**:

- Code duplication
- Inconsistent usage patterns
- One file imports from wrong location: `lib/stacks/storage/efs-file-system-stack.ts` imports from `../compute/lambda-stack`

**Recommendation**:

- ✅ **Keep**: `lib/constructs/compute/lambda/lambda-function-construct.ts`
- ❌ **Remove**: `lib/stacks/compute/lambda-stack.ts` (move to constructs if needed, or delete)
- ✅ **Update**: All imports to use `lib/constructs/compute/lambda`

**Action**: Remove duplicate and update all imports

---

### 3. SubnetConstruct is Non-Functional ❌

**Location**: `lib/constructs/networking/vpc/subnet-construct.ts`

**Problem**:

- Construct throws an error on instantiation (line 48-50)
- Only contains helper class `SubnetConfigurationHelper`
- Documentation says "for reference only"

**Impact**:

- Misleading - appears to be a usable construct but isn't
- Exported from index but unusable
- Helper class is duplicated in `networking-stack.ts`

**Recommendation**:

- **Option A**: Remove `SubnetConstruct` class entirely, keep only `SubnetConfigurationHelper`
- **Option B**: Implement the construct properly if it's needed
- ✅ **Consolidate**: Move `SubnetConfigurationHelper` to a shared utilities file or keep in VPC construct

**Action**: Remove non-functional construct, consolidate helper class

---

### 4. VPC Peering Construct Export Path Issue ⚠️

**Location**:

- Construct: `lib/constructs/networking/vpc/vpc-peering-construct.ts` ✅
- Export: `lib/constructs/networking/index.ts` references `./vpc-peering-construct` ❌

**Problem**:

- Export path `./vpc-peering-construct` doesn't exist at that level
- File is actually at `./vpc/vpc-peering-construct.ts`

**Impact**:

- Broken exports
- Import errors if using from `lib/constructs/networking`

**Recommendation**:

- ✅ **Fix**: Update export to `export * from "./vpc/vpc-peering-construct"`

**Action**: Fix export path

---

## Domain Organisation Issues

### 5. IAM Constructs - Correct Placement ✅

**Status**: All IAM constructs are correctly placed in `lib/constructs/iam/`:

- ✅ `vpc-peering-acceptor-role.ts` - Correct (VPC peering is IAM concern)
- ✅ `ecs-task-execution-role.ts` - Correct (ECS IAM role)
- ✅ `eventbridge-cross-account-role.ts` - Correct (EventBridge IAM role)

**Note**: These are correctly separated from the resources they support, which is good practice.

---

### 6. Storage Constructs - Minimal Implementation ⚠️

**Location**: `lib/constructs/storage/ecr/ecr-construct.ts`

**Problem**:

- Only 53 lines, minimal implementation
- Good structure but very basic
- No clear indication if this is complete or a stub

**Recommendation**:

- ✅ **Keep**: Structure is correct
- ⚠️ **Enhance**: Add lifecycle policies, cross-account access patterns if needed
- ✅ **Location**: Correct domain folder

---

### 7. VPC Peering Construct Dependencies ⚠️

**Location**: `lib/constructs/networking/vpc/vpc-peering-construct.ts`

**Dependencies**:

- Imports `LambdaFunctionConstruct` from `../compute/lambda` (line 11)
- Creates Lambda functions internally (lines 182, 264)

**Analysis**:

- ✅ **Correct**: Networking construct can depend on compute constructs
- ⚠️ **Consider**: Could extract Lambda creation to separate method or helper
- ✅ **Location**: Correct - VPC peering is networking concern

**Recommendation**: Current structure is acceptable, but consider extracting Lambda creation logic if construct grows.

---

## Naming Consistency

### 8. File Naming Patterns ✅

**Pattern Analysis**:

- ✅ `*-construct.ts` - Consistent suffix
- ✅ `kebab-case` for file names
- ✅ `PascalCase` for class names
- ✅ Domain folders match AWS service categories

**Examples**:

- ✅ `lambda-function-construct.ts` → `LambdaFunctionConstruct`
- ✅ `vpc-peering-construct.ts` → `VpcPeeringConstruct`
- ✅ `ecs-task-execution-role.ts` → `EcsTaskExecutionRole`

**Status**: Naming is consistent and follows conventions.

---

## Construct Size Analysis

### 9. Construct Complexity Review

**Large Constructs** (should consider splitting):

- `vpc-peering-construct.ts` - 313 lines
  - Creates multiple Lambda functions
  - Handles custom resources
  - Manages route tables
  - **Recommendation**: Consider splitting into:
    - `VpcPeeringConnectionConstruct` (peering creation/acceptance)
    - `VpcPeeringRouteConstruct` (route table management)
    - Or keep as-is if tightly coupled

**Medium Constructs** (appropriate size):

- `lambda-function-construct.ts` - 195 lines ✅
- `vpc-construct.ts` - 144 lines ✅
- `ecs-task-execution-role.ts` - 103 lines ✅

**Small Constructs** (may need enhancement):

- `ecr-construct.ts` - 53 lines (minimal but complete)
- `eventbridge-cross-account-role.ts` - 84 lines ✅
- `vpc-peering-acceptor-role.ts` - 117 lines ✅

**Recommendation**: Most constructs are appropriately sized. Only `vpc-peering-construct.ts` might benefit from splitting, but current structure is acceptable.

---

## Recommendations Summary

### High Priority

1. **Remove duplicate VPC constructs**

   - Delete `lib/constructs/networking/vpc-construct.ts`
   - Refactor `networking-stack.ts` to use `lib/constructs/networking/vpc/vpc-construct.ts`

2. **Remove duplicate Lambda construct**

   - Delete `lib/stacks/compute/lambda-stack.ts`
   - Update imports in `efs-file-system-stack.ts` to use constructs folder

3. **Fix VPC peering export path**

   - Update `lib/constructs/networking/index.ts` line 13

4. **Remove or fix SubnetConstruct**
   - Remove the throwing construct class
   - Consolidate `SubnetConfigurationHelper` (remove duplication)

### Medium Priority

5. **Review ECR construct completeness**

   - Verify if additional features needed (lifecycle policies, cross-account)

6. **Consider splitting VPC peering construct**
   - Only if it grows further or becomes hard to maintain

### Low Priority

7. **Documentation**
   - Add JSDoc comments explaining when to use each construct
   - Document construct dependencies

---

## Correct File Structure (After Fixes)

```
lib/constructs/
├── compute/
│   ├── lambda/
│   │   ├── lambda-function-construct.ts ✅
│   │   └── index.ts
│   └── ...
├── iam/
│   ├── ecs-task-execution-role.ts ✅
│   ├── eventbridge-cross-account-role.ts ✅
│   └── vpc-peering-acceptor-role.ts ✅
├── networking/
│   ├── vpc/
│   │   ├── vpc-construct.ts ✅ (consolidated)
│   │   ├── vpc-peering-construct.ts ✅
│   │   ├── vpc-flow-logs-construct.ts ✅
│   │   └── subnet-construct.ts ⚠️ (remove or fix)
│   └── ...
└── storage/
    └── ecr/
        └── ecr-construct.ts ✅
```

---

## Checklist

- [x] Is this file in the correct domain folder?

  - ✅ Most files are correctly placed
  - ❌ Duplicates need removal
  - ⚠️ SubnetConstruct needs decision

- [x] Should it be split into multiple smaller constructs?

  - ✅ Most constructs are appropriately sized
  - ⚠️ VPC peering construct could be split but acceptable as-is

- [x] Are there dependencies that suggest wrong placement?

  - ✅ IAM roles correctly separated
  - ✅ VPC peering correctly in networking
  - ⚠️ Lambda dependency in VPC peering is acceptable

- [x] Is the file name consistent with naming patterns?
  - ✅ All files follow `kebab-case` + `-construct.ts` pattern
  - ✅ Class names use `PascalCase`
