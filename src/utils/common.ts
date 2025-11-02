import {
  Instance,
  MachineSet,
  Platform,
  Service,
  NodeOverCommitMetrics,
  ClusterOverCommitMetrics,
} from "../types";
import { Node } from "../types";
import {
  getNodeKubeletCPURequirements,
  getNodeKubeletMemoryRequirements,
} from "./kubelet";

type ResourceRequirement = {
  totalMem: number;
  totalCPU: number;
  totalDisks: number;
};

export const getTotalResourceRequirement = (
  services: Service[],
  multiplyByZone?: boolean
): ResourceRequirement => {
  return services.reduce(
    (acc, service) => {
      if (service.name.includes("Ceph_OSD")) {
        acc.totalDisks += 1;
      }
      acc.totalMem += multiplyByZone
        ? service.requiredMemory * service.zones
        : service.requiredMemory;
      acc.totalCPU += multiplyByZone
        ? service.requiredCPU * service.zones
        : service.requiredCPU;
      return acc;
    },
    { totalMem: 0, totalCPU: 0, totalDisks: 0 }
  );
};

export const canNodeSupportRequirements = (
  requirements: ResourceRequirement,
  currentUsage: ResourceRequirement,
  node: Node
): boolean => {
  const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
  const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);

  return requirements.totalCPU + currentUsage.totalCPU + kubeletCPU >
    node.cpuUnits ||
    requirements.totalMem + currentUsage.totalMem + kubeletMemory >
      node.memory ||
    requirements.totalDisks + currentUsage.totalDisks > node.maxDisks
    ? false
    : true;
};
export const isCloudPlatform = (platform: Platform): boolean =>
  [
    Platform.AWS,
    Platform.AZURE,
    Platform.GCP,
    Platform.IBMC,
    Platform.IBMV,
  ].includes(platform);

export const getMachinetSetFromInstance = (
  instance: Instance,
  id: number,
  name: string,
  label: string,
  onlyFor: string[] = [],
  maxDisks?: number
): MachineSet => {
  return {
    id,
    name,
    cpu: instance.cpuUnits,
    memory: instance.memory,
    instanceName: instance.name,
    numberOfDisks: maxDisks ?? instance.maxDisks,
    onlyFor,
    label,
  };
};

/**
 * Calculate over-commit metrics for a single node
 * @param node - The node to analyze
 * @param services - Services running on the node
 * @returns NodeOverCommitMetrics with requested/limit resources and ratios
 */
export const calculateNodeOverCommit = (
  node: Node,
  services: Service[]
): NodeOverCommitMetrics => {
  // Calculate Kubelet overhead
  const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
  const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);

  // Available capacity after Kubelet
  const availableCPU = node.cpuUnits - kubeletCPU;
  const availableMemory = node.memory - kubeletMemory;

  // Sum up requests from services
  const requestedCPU = services.reduce(
    (sum, service) => sum + service.requiredCPU,
    0
  );
  const requestedMemory = services.reduce(
    (sum, service) => sum + service.requiredMemory,
    0
  );

  // Check if any service has dynamic limits (min/max ranges)
  const hasDynamicLimits = services.some(
    (service) =>
      service.minLimitCPU ||
      service.maxLimitCPU ||
      service.minLimitMemory ||
      service.maxLimitMemory
  );

  // Calculate min and max limits
  const minLimitCPU = services.reduce((sum, service) => {
    return (
      sum + (service.minLimitCPU ?? service.limitCPU ?? service.requiredCPU)
    );
  }, 0);

  const maxLimitCPU = services.reduce((sum, service) => {
    return (
      sum + (service.maxLimitCPU ?? service.limitCPU ?? service.requiredCPU)
    );
  }, 0);

  const minLimitMemory = services.reduce((sum, service) => {
    return (
      sum +
      (service.minLimitMemory ?? service.limitMemory ?? service.requiredMemory)
    );
  }, 0);

  const maxLimitMemory = services.reduce((sum, service) => {
    return (
      sum +
      (service.maxLimitMemory ?? service.limitMemory ?? service.requiredMemory)
    );
  }, 0);

  // Determine if we should return ranges or single values
  const limitCPU = hasDynamicLimits
    ? { min: minLimitCPU, max: maxLimitCPU }
    : maxLimitCPU; // For static, use max (which equals min)

  const limitMemory = hasDynamicLimits
    ? { min: minLimitMemory, max: maxLimitMemory }
    : maxLimitMemory;

  // Calculate over-commit ratios (limits / available capacity after Kubelet)
  const minCpuRatio = availableCPU > 0 ? minLimitCPU / availableCPU : 1;
  const maxCpuRatio = availableCPU > 0 ? maxLimitCPU / availableCPU : 1;
  const minMemoryRatio =
    availableMemory > 0 ? minLimitMemory / availableMemory : 1;
  const maxMemoryRatio =
    availableMemory > 0 ? maxLimitMemory / availableMemory : 1;

  const cpuOverCommitRatio = hasDynamicLimits
    ? { min: minCpuRatio, max: maxCpuRatio }
    : maxCpuRatio;

  const memoryOverCommitRatio = hasDynamicLimits
    ? { min: minMemoryRatio, max: maxMemoryRatio }
    : maxMemoryRatio;

  // Determine risk level based on worst-case (max) over-commit ratios
  const maxRatio = Math.max(maxCpuRatio, maxMemoryRatio);
  let riskLevel: "none" | "low" | "medium" | "high";
  if (maxRatio <= 1) {
    riskLevel = "none";
  } else if (maxRatio <= 2) {
    riskLevel = "low";
  } else if (maxRatio <= 4) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  return {
    requestedCPU,
    requestedMemory,
    limitCPU,
    limitMemory,
    cpuOverCommitRatio,
    memoryOverCommitRatio,
    riskLevel,
  };
};

/**
 * Calculate over-commit metrics for the entire cluster
 * @param nodes - All nodes in the cluster
 * @param services - All services in the cluster
 * @returns ClusterOverCommitMetrics with cluster-wide over-commit info
 */
export const calculateClusterOverCommit = (
  nodes: Node[],
  services: Service[]
): ClusterOverCommitMetrics => {
  // Calculate total allocatable capacity (after Kubelet for all nodes)
  const totalAllocatable = nodes.reduce(
    (acc, node) => {
      const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
      const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);
      return {
        cpu: acc.cpu + (node.cpuUnits - kubeletCPU),
        memory: acc.memory + (node.memory - kubeletMemory),
      };
    },
    { cpu: 0, memory: 0 }
  );

  // Calculate total requests and limits based on actual service placements on nodes
  // Count how many times each service is placed on nodes
  const servicePlacements = nodes.flatMap((node) => node.services);
  // Create a map to count placements per service ID
  const placementCounts = servicePlacements.reduce((acc, serviceId) => {
    acc[serviceId] = (acc[serviceId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // Check if any service has dynamic limits
  const hasDynamicLimits = services.some(
    (service) =>
      service.minLimitCPU ||
      service.maxLimitCPU ||
      service.minLimitMemory ||
      service.maxLimitMemory
  );

  // Calculate totals by multiplying each service's resources by its placement count
  const totalRequests = { cpu: 0, memory: 0 };
  let minTotalLimitCPU = 0;
  let maxTotalLimitCPU = 0;
  let minTotalLimitMemory = 0;
  let maxTotalLimitMemory = 0;

  services.forEach((service) => {
    const placementCount = placementCounts[service.id as number] || 0;
    totalRequests.cpu += service.requiredCPU * placementCount;
    totalRequests.memory += service.requiredMemory * placementCount;

    // Calculate min and max limits for each service
    const minCPU =
      service.minLimitCPU ?? service.limitCPU ?? service.requiredCPU;
    const maxCPU =
      service.maxLimitCPU ?? service.limitCPU ?? service.requiredCPU;
    const minMemory =
      service.minLimitMemory ?? service.limitMemory ?? service.requiredMemory;
    const maxMemory =
      service.maxLimitMemory ?? service.limitMemory ?? service.requiredMemory;

    minTotalLimitCPU += minCPU * placementCount;
    maxTotalLimitCPU += maxCPU * placementCount;
    minTotalLimitMemory += minMemory * placementCount;
    maxTotalLimitMemory += maxMemory * placementCount;
  });

  // Determine if we should return ranges or single values
  const totalLimits = {
    cpu: hasDynamicLimits
      ? { min: minTotalLimitCPU, max: maxTotalLimitCPU }
      : maxTotalLimitCPU,
    memory: hasDynamicLimits
      ? { min: minTotalLimitMemory, max: maxTotalLimitMemory }
      : maxTotalLimitMemory,
  };

  // Calculate over-commit ratios
  const minCpuRatio =
    totalAllocatable.cpu > 0 ? minTotalLimitCPU / totalAllocatable.cpu : 1;
  const maxCpuRatio =
    totalAllocatable.cpu > 0 ? maxTotalLimitCPU / totalAllocatable.cpu : 1;
  const minMemoryRatio =
    totalAllocatable.memory > 0
      ? minTotalLimitMemory / totalAllocatable.memory
      : 1;
  const maxMemoryRatio =
    totalAllocatable.memory > 0
      ? maxTotalLimitMemory / totalAllocatable.memory
      : 1;

  const overCommitRatio = {
    cpu: hasDynamicLimits
      ? { min: minCpuRatio, max: maxCpuRatio }
      : maxCpuRatio,
    memory: hasDynamicLimits
      ? { min: minMemoryRatio, max: maxMemoryRatio }
      : maxMemoryRatio,
  };

  // Determine risk level based on worst-case (max) ratios
  const maxRatio = Math.max(maxCpuRatio, maxMemoryRatio);
  let riskLevel: "none" | "low" | "medium" | "high";
  if (maxRatio <= 1) {
    riskLevel = "none";
  } else if (maxRatio <= 2) {
    riskLevel = "low";
  } else if (maxRatio <= 4) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  return {
    totalRequests,
    totalLimits,
    totalAllocatable,
    overCommitRatio,
    riskLevel,
  };
};
