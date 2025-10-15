import { MachineSet, Node, Workload } from "../types";

/**
 * Creates a control plane machine set with optional workload scheduling
 */
export const createControlPlaneMachineSet = (
  baseInstance: {
    cpuUnits: number;
    memory: number;
    name: string;
    maxDisks?: number;
  },
  platform: string,
  allowWorkloadScheduling = false,
  reservedResources?: { cpu: number; memory: number }
): MachineSet => {
  return {
    id: 1,
    name: "controlPlane",
    cpu: baseInstance.cpuUnits,
    memory: baseInstance.memory,
    instanceName: baseInstance.name,
    numberOfDisks: baseInstance.maxDisks ?? 24,
    onlyFor: allowWorkloadScheduling ? [] : ["ControlPlane"],
    label: "Control Plane Node",
    allowWorkloadScheduling,
    controlPlaneReserved: reservedResources ?? {
      cpu: 2, // Default: Reserve 2 CPU for control plane services
      memory: 4, // Default: Reserve 4GB for control plane services
    },
  };
};

/**
 * Checks if a workload can be scheduled on control plane nodes
 */
export const canWorkloadRunOnControlPlane = (
  workload: Workload,
  controlPlaneNode: Node
): boolean => {
  // If workload explicitly requires control plane
  if (workload.requireControlPlane) {
    return true;
  }

  // If workload allows control plane and node allows workloads
  if (workload.allowControlPlane && controlPlaneNode.allowWorkloadScheduling) {
    return true;
  }

  // If workload explicitly targets control plane machine set
  if (workload.usesMachines?.includes("controlPlane")) {
    return true;
  }

  return false;
};

/**
 * Calculates available resources on a control plane node after reservations
 */
export const getControlPlaneAvailableResources = (
  node: Node
): { cpu: number; memory: number } => {
  if (!node.isControlPlane || !node.controlPlaneReserved) {
    return { cpu: node.cpuUnits, memory: node.memory };
  }

  return {
    cpu: node.cpuUnits - node.controlPlaneReserved.cpu,
    memory: node.memory - node.controlPlaneReserved.memory,
  };
};

/**
 * Creates a workload that explicitly targets control plane nodes
 */
export const createControlPlaneWorkload = (
  name: string,
  services: { id: number }[],
  requireControlPlane = true
): Workload => {
  return {
    name,
    count: 1,
    usesMachines: requireControlPlane ? ["controlPlane"] : [],
    services: services.map((s) => s.id),
    storageCapacityRequired: 0,
    allowControlPlane: true,
    requireControlPlane,
  };
};

/**
 * Validates control plane scheduling configuration
 */
export const validateControlPlaneConfig = (
  machineSet: MachineSet,
  workloads: Workload[]
): { valid: boolean; warnings: string[] } => {
  const warnings: string[] = [];

  if (machineSet.name === "controlPlane") {
    // Check if control plane has enough resources for reserved + workloads
    if (machineSet.allowWorkloadScheduling) {
      const reserved = machineSet.controlPlaneReserved;
      if (reserved) {
        const availableCPU = machineSet.cpu - reserved.cpu;
        const availableMemory = machineSet.memory - reserved.memory;

        if (availableCPU < 2) {
          warnings.push(
            "Control plane may not have enough CPU for workloads after reservations"
          );
        }
        if (availableMemory < 4) {
          warnings.push(
            "Control plane may not have enough memory for workloads after reservations"
          );
        }
      }
    }

    // Check for workloads that require control plane but scheduling is disabled
    const requiresControlPlane = workloads.filter((w) => w.requireControlPlane);
    if (
      requiresControlPlane.length > 0 &&
      !machineSet.allowWorkloadScheduling
    ) {
      warnings.push(
        `${requiresControlPlane.length} workload(s) require control plane but scheduling is disabled`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
};
