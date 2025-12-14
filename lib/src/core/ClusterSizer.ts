import {
  WorkloadDescriptor,
  MachineSet,
  Platform,
  Zone,
  Node,
  Service,
  Workload,
} from "../types";
import { workloadScheduler } from "../scheduler";
import { getDefaultInstanceForPlatform } from "../data";
import { getWorkloadFromDescriptors } from "../utils/workload";

export type ClusterSizing = {
  nodeCount: number;
  zones: number;
  totalCPU: number;
  totalMemory: number;
  nodes?: Node[];
  zoneDetails?: Zone[];
  services?: Service[];
};

export class ClusterSizer {
  /**
   * Main sizing function
   * @param workloads Array of workload descriptors
   * @param platform Target platform (AWS, Azure, GCP, BareMetal, etc.)
   * @param machineSets Optional custom machine sets (uses platform defaults if not provided)
   */
  static size(
    workloads: WorkloadDescriptor[],
    platform: Platform,
    machineSets?: MachineSet[]
  ): ClusterSizing {
    let zones: Zone[] = [];
    let nodes: Node[] = [];
    const allServices: Service[] = [];
    const allWorkloads: Workload[] = [];

    // Use provided machineSets or get platform defaults
    const availableMachineSets =
      machineSets || this.getDefaultMachineSets(platform);

    // Convert workload descriptors to workloads and services
    workloads.forEach((workloadDesc) => {
      const { workload, services } = getWorkloadFromDescriptors(workloadDesc);
      allWorkloads.push(workload);
      allServices.push(...services);
    });

    // Validate that all services can fit on available machine sets
    this.validateServicesCanSchedule(allServices, availableMachineSets);

    // Schedule each workload
    const usedZonesId: number[] = [];
    allWorkloads.forEach((workload) => {
      const result = workloadScheduler(
        workload,
        allServices,
        availableMachineSets,
        zones,
        nodes,
        usedZonesId
      );
      zones = result.zones;
      nodes = result.nodes;
    });

    return {
      nodeCount: nodes.length,
      zones: zones.length,
      totalCPU: nodes.reduce((sum, n) => sum + n.cpuUnits, 0),
      totalMemory: nodes.reduce((sum, n) => sum + n.memory, 0),
      nodes,
      zoneDetails: zones,
      services: allServices,
    };
  }

  /**
   * Validate that all services can be scheduled on available machine sets
   * @param services Array of services to validate
   * @param machineSets Array of available machine sets
   * @throws Error if any service cannot fit on any machine set
   */
  private static validateServicesCanSchedule(
    services: Service[],
    machineSets: MachineSet[]
  ): void {
    for (const service of services) {
      // Check if service can fit on any available machine set
      const canFitOnAnyMachine = machineSets.some((machineSet) => {
        // Calculate effective capacity considering over-commitment
        const effectiveCPU = machineSet.cpu;
        const effectiveMemory = machineSet.memory;

        // For validation, use the requested resources (not limits)
        // as those are the minimum guaranteed resources needed
        const serviceCPU = service.requiredCPU;
        const serviceMemory = service.requiredMemory;

        return serviceCPU <= effectiveCPU && serviceMemory <= effectiveMemory;
      });

      if (!canFitOnAnyMachine) {
        const largestMachine = machineSets.reduce(
          (largest, current) =>
            current.cpu > largest.cpu ? current : largest,
          machineSets[0]
        );

        throw new Error(
          `Service "${service.name}" cannot be scheduled: requires ${service.requiredCPU} CPU and ${service.requiredMemory} GB memory, ` +
            `but largest available machine set has only ${largestMachine.cpu} CPU and ${largestMachine.memory} GB memory. ` +
            `Consider using a larger machine type or reducing the service resource requirements.`
        );
      }
    }
  }

  /**
   * Get default machine sets for a platform
   */
  private static getDefaultMachineSets(platform: Platform): MachineSet[] {
    const defaultInstance = getDefaultInstanceForPlatform(platform);

    return [
      {
        name: "default",
        cpu: defaultInstance.cpuUnits,
        memory: defaultInstance.memory,
        instanceName: defaultInstance.name,
        numberOfDisks: defaultInstance.maxDisks || 24,
        onlyFor: [],
        label: "Worker Node",
      },
    ];
  }
}
