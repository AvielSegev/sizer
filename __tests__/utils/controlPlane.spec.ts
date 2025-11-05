import {
  createControlPlaneMachineSet,
  canWorkloadRunOnControlPlane,
  getControlPlaneAvailableResources,
  createControlPlaneWorkload,
  validateControlPlaneConfig,
} from "../../src/utils/controlPlane";
import { MachineSet, Node, Workload } from "../../src/types";

describe("Control Plane Utilities", () => {
  describe("createControlPlaneMachineSet", () => {
    it("should create a control plane machine set with default reserved resources", () => {
      const baseInstance = {
        cpuUnits: 24,
        memory: 64,
        name: "test-instance",
        maxDisks: 24,
      };

      const machineSet = createControlPlaneMachineSet(
        baseInstance,
        "BareMetal",
        true
      );

      expect(machineSet.name).toBe("controlPlane");
      expect(machineSet.cpu).toBe(24);
      expect(machineSet.memory).toBe(64);
      expect(machineSet.allowWorkloadScheduling).toBe(true);
      expect(machineSet.controlPlaneReserved).toEqual({
        cpu: 2,
        memory: 4,
      });
      expect(machineSet.onlyFor).toEqual([]);
    });

    it("should create a control plane machine set with custom reserved resources", () => {
      const baseInstance = {
        cpuUnits: 32,
        memory: 128,
        name: "large-instance",
      };

      const machineSet = createControlPlaneMachineSet(
        baseInstance,
        "AWS",
        true,
        { cpu: 8, memory: 16 }
      );

      expect(machineSet.controlPlaneReserved).toEqual({
        cpu: 8,
        memory: 16,
      });
    });

    it("should create a control plane machine set with workload scheduling disabled", () => {
      const baseInstance = {
        cpuUnits: 24,
        memory: 64,
        name: "test-instance",
      };

      const machineSet = createControlPlaneMachineSet(
        baseInstance,
        "BareMetal",
        false
      );

      expect(machineSet.allowWorkloadScheduling).toBe(false);
      expect(machineSet.onlyFor).toEqual(["ControlPlane"]);
    });
  });

  describe("canWorkloadRunOnControlPlane", () => {
    const controlPlaneNode: Node = {
      id: 1,
      maxDisks: 24,
      cpuUnits: 24,
      memory: 64,
      machineSet: "controlPlane",
      services: [],
      onlyFor: [],
      isControlPlane: true,
      allowWorkloadScheduling: true,
      controlPlaneReserved: {
        cpu: 4,
        memory: 8,
      },
    };

    it("should allow workload that requires control plane", () => {
      const workload: Workload = {
        id: 1,
        name: "test-workload",
        count: 1,
        usesMachines: [],
        services: [1],
        requireControlPlane: true,
      };

      expect(canWorkloadRunOnControlPlane(workload, controlPlaneNode)).toBe(
        true
      );
    });

    it("should allow workload that allows control plane when node allows scheduling", () => {
      const workload: Workload = {
        id: 1,
        name: "test-workload",
        count: 1,
        usesMachines: [],
        services: [1],
        allowControlPlane: true,
      };

      expect(canWorkloadRunOnControlPlane(workload, controlPlaneNode)).toBe(
        true
      );
    });

    it("should reject workload that allows control plane when node does not allow scheduling", () => {
      const restrictedNode: Node = {
        ...controlPlaneNode,
        allowWorkloadScheduling: false,
      };

      const workload: Workload = {
        id: 1,
        name: "test-workload",
        count: 1,
        usesMachines: [],
        services: [1],
        allowControlPlane: true,
      };

      expect(canWorkloadRunOnControlPlane(workload, restrictedNode)).toBe(
        false
      );
    });

    it("should allow workload that explicitly targets control plane machine set", () => {
      const workload: Workload = {
        id: 1,
        name: "test-workload",
        count: 1,
        usesMachines: ["controlPlane"],
        services: [1],
      };

      expect(canWorkloadRunOnControlPlane(workload, controlPlaneNode)).toBe(
        true
      );
    });

    it("should reject regular workload without control plane flags", () => {
      const workload: Workload = {
        id: 1,
        name: "test-workload",
        count: 1,
        usesMachines: [],
        services: [1],
      };

      expect(canWorkloadRunOnControlPlane(workload, controlPlaneNode)).toBe(
        false
      );
    });
  });

  describe("getControlPlaneAvailableResources", () => {
    it("should return available resources after reservation for control plane node", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 24,
        memory: 64,
        machineSet: "controlPlane",
        services: [],
        onlyFor: [],
        isControlPlane: true,
        allowWorkloadScheduling: true,
        controlPlaneReserved: {
          cpu: 4,
          memory: 8,
        },
      };

      const available = getControlPlaneAvailableResources(node);

      expect(available.cpu).toBe(20);
      expect(available.memory).toBe(56);
    });

    it("should return total resources for non-control plane node", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 24,
        memory: 64,
        machineSet: "default",
        services: [],
        onlyFor: [],
      };

      const available = getControlPlaneAvailableResources(node);

      expect(available.cpu).toBe(24);
      expect(available.memory).toBe(64);
    });

    it("should return total resources for control plane node without reservations", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 24,
        memory: 64,
        machineSet: "controlPlane",
        services: [],
        onlyFor: [],
        isControlPlane: true,
        allowWorkloadScheduling: true,
      };

      const available = getControlPlaneAvailableResources(node);

      expect(available.cpu).toBe(24);
      expect(available.memory).toBe(64);
    });
  });

  describe("createControlPlaneWorkload", () => {
    it("should create a workload that requires control plane", () => {
      const services = [{ id: 1 }, { id: 2 }];

      const workload = createControlPlaneWorkload(
        "test-cp-workload",
        services,
        true
      );

      expect(workload.name).toBe("test-cp-workload");
      expect(workload.requireControlPlane).toBe(true);
      expect(workload.allowControlPlane).toBe(true);
      expect(workload.usesMachines).toEqual(["controlPlane"]);
      expect(workload.services).toEqual([1, 2]);
    });

    it("should create a workload that allows but does not require control plane", () => {
      const services = [{ id: 1 }];

      const workload = createControlPlaneWorkload(
        "test-cp-workload",
        services,
        false
      );

      expect(workload.requireControlPlane).toBe(false);
      expect(workload.allowControlPlane).toBe(true);
      expect(workload.usesMachines).toEqual([]);
    });
  });

  describe("validateControlPlaneConfig", () => {
    it("should validate control plane with sufficient resources", () => {
      const machineSet: MachineSet = {
        id: 1,
        name: "controlPlane",
        cpu: 24,
        memory: 64,
        instanceName: "test",
        numberOfDisks: 24,
        onlyFor: [],
        label: "Control Plane Node",
        allowWorkloadScheduling: true,
        controlPlaneReserved: {
          cpu: 4,
          memory: 8,
        },
      };

      const workloads: Workload[] = [];

      const result = validateControlPlaneConfig(machineSet, workloads);

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("should warn when available CPU is too low after reservations", () => {
      const machineSet: MachineSet = {
        id: 1,
        name: "controlPlane",
        cpu: 4,
        memory: 64,
        instanceName: "test",
        numberOfDisks: 24,
        onlyFor: [],
        label: "Control Plane Node",
        allowWorkloadScheduling: true,
        controlPlaneReserved: {
          cpu: 3,
          memory: 8,
        },
      };

      const workloads: Workload[] = [];

      const result = validateControlPlaneConfig(machineSet, workloads);

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain(
        "Control plane may not have enough CPU for workloads after reservations"
      );
    });

    it("should warn when available memory is too low after reservations", () => {
      const machineSet: MachineSet = {
        id: 1,
        name: "controlPlane",
        cpu: 24,
        memory: 8,
        instanceName: "test",
        numberOfDisks: 24,
        onlyFor: [],
        label: "Control Plane Node",
        allowWorkloadScheduling: true,
        controlPlaneReserved: {
          cpu: 4,
          memory: 6,
        },
      };

      const workloads: Workload[] = [];

      const result = validateControlPlaneConfig(machineSet, workloads);

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain(
        "Control plane may not have enough memory for workloads after reservations"
      );
    });

    it("should warn when workloads require control plane but scheduling is disabled", () => {
      const machineSet: MachineSet = {
        id: 1,
        name: "controlPlane",
        cpu: 24,
        memory: 64,
        instanceName: "test",
        numberOfDisks: 24,
        onlyFor: [],
        label: "Control Plane Node",
        allowWorkloadScheduling: false,
        controlPlaneReserved: {
          cpu: 4,
          memory: 8,
        },
      };

      const workloads: Workload[] = [
        {
          id: 1,
          name: "cp-workload",
          count: 1,
          usesMachines: [],
          services: [1],
          requireControlPlane: true,
        },
        {
          id: 2,
          name: "cp-workload-2",
          count: 1,
          usesMachines: [],
          services: [2],
          requireControlPlane: true,
        },
      ];

      const result = validateControlPlaneConfig(machineSet, workloads);

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain(
        "2 workload(s) require control plane but scheduling is disabled"
      );
    });

    it("should not validate non-control plane machine sets", () => {
      const machineSet: MachineSet = {
        id: 1,
        name: "default",
        cpu: 24,
        memory: 64,
        instanceName: "test",
        numberOfDisks: 24,
        onlyFor: [],
        label: "Worker Node",
      };

      const workloads: Workload[] = [
        {
          id: 1,
          name: "cp-workload",
          count: 1,
          usesMachines: [],
          services: [1],
          requireControlPlane: true,
        },
      ];

      const result = validateControlPlaneConfig(machineSet, workloads);

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });
});
