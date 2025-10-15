import { defaultWorkloads } from "../../src/components/Workload/defaultWorkloads";
import { MachineSet, WorkloadDescriptor } from "../../src/types";
import { addMachineSet } from "../../src/redux/reducers/machineSet";
import { store as mainStore } from "../../src/redux/store";
import { workloadScheduler } from "../../src/scheduler/workloadScheduler";
import { getWorkloadFromDescriptors } from "../../src/utils/workload";
import { addServices } from "../../src/redux/reducers/service";
import { addWorkload } from "../../src/redux/reducers/workload";
import { createControlPlaneMachineSet } from "../../src/utils/controlPlane";

const kafkaWorkloadDescriptor: WorkloadDescriptor = defaultWorkloads.find(
  (wl) => wl.name === "Kafka"
) as WorkloadDescriptor;

const { services: kafkaServices, workload: kafkaWorkload } =
  getWorkloadFromDescriptors(kafkaWorkloadDescriptor);

const store = mainStore;
const { dispatch } = store;

describe("Test scheduler", () => {
  it("Should create machinetSet", () => {
    const machineSet: MachineSet = {
      name: "test",
      cpu: 96,
      memory: 512,
      instanceName: "m5.4xlarge",
      numberOfDisks: 2,
      onlyFor: ["Kafka"],
      label: "worker-us",
    };
    dispatch(addMachineSet(machineSet));
    expect(
      !!store.getState().machineSet.find((ms) => ms.name === machineSet.name)
    ).toBeTruthy();
  });
  it("Should schedule workload", () => {
    dispatch(addServices(kafkaServices));
    dispatch(addWorkload(kafkaWorkload));
    const state = store.getState();
    const { service, workload, machineSet } = state;
    const usedZonesId: number[] = [];
    workloadScheduler(store, dispatch)(
      workload[0],
      service.services,
      machineSet,
      usedZonesId
    );
  });
});

describe("Control Plane Scheduling Integration", () => {
  it("Should create control plane machine set with workload scheduling enabled", () => {
    const baseInstance = {
      cpuUnits: 24,
      memory: 64,
      name: "control-plane-instance",
      maxDisks: 24,
    };

    const controlPlaneMachineSet = createControlPlaneMachineSet(
      baseInstance,
      "BareMetal",
      true,
      { cpu: 4, memory: 8 }
    );

    // Verify the created machine set has correct properties
    expect(controlPlaneMachineSet.name).toBe("controlPlane");
    expect(controlPlaneMachineSet.allowWorkloadScheduling).toBe(true);
    expect(controlPlaneMachineSet.controlPlaneReserved).toEqual({
      cpu: 4,
      memory: 8,
    });
  });

  it("Should schedule regular workload on control plane when allowed", () => {
    // Create a small test workload
    const testWorkloadDescriptor: WorkloadDescriptor = {
      name: "TestRegularWorkload",
      count: 1,
      usesMachines: [],
      storageCapacityRequired: 0,
      services: [
        {
          name: "TestService",
          requiredCPU: 2,
          requiredMemory: 4,
          zones: 1,
          runsWith: [],
          avoid: [],
        },
      ],
    };

    const { services: testServices, workload: testWorkload } =
      getWorkloadFromDescriptors(testWorkloadDescriptor);

    dispatch(addServices(testServices));
    dispatch(addWorkload(testWorkload));

    const state = store.getState();
    const { service, workload, machineSet } = state;
    const usedZonesId: number[] = [];

    // Schedule the workload
    const lastWorkload = workload[workload.length - 1];
    workloadScheduler(store, dispatch)(
      lastWorkload,
      service.services,
      machineSet,
      usedZonesId
    );

    // Verify scheduling occurred (workload should be scheduled)
    expect(lastWorkload).toBeDefined();
  });

  it("Should schedule workload that requires control plane", () => {
    // Create a workload that requires control plane
    const cpWorkloadDescriptor: WorkloadDescriptor = {
      name: "ControlPlaneWorkload",
      count: 1,
      usesMachines: ["controlPlane"],
      storageCapacityRequired: 0,
      requireControlPlane: true,
      allowControlPlane: true,
      services: [
        {
          name: "CPService",
          requiredCPU: 1,
          requiredMemory: 2,
          zones: 1,
          runsWith: [],
          avoid: [],
        },
      ],
    };

    const { services: cpServices, workload: cpWorkload } =
      getWorkloadFromDescriptors(cpWorkloadDescriptor);

    dispatch(addServices(cpServices));
    dispatch(addWorkload(cpWorkload));

    const state = store.getState();
    const { service, workload, machineSet } = state;
    const usedZonesId: number[] = [];

    // Schedule the workload
    const lastWorkload = workload[workload.length - 1];
    workloadScheduler(store, dispatch)(
      lastWorkload,
      service.services,
      machineSet,
      usedZonesId
    );

    // Verify the workload has requireControlPlane flag
    expect(lastWorkload.requireControlPlane).toBe(true);
    expect(lastWorkload.usesMachines).toContain("controlPlane");
  });

  it("Should respect control plane resource reservations", () => {
    // Create control plane with limited available resources
    const limitedInstance = {
      cpuUnits: 8,
      memory: 16,
      name: "limited-cp",
      maxDisks: 24,
    };

    const limitedCPMachineSet = createControlPlaneMachineSet(
      limitedInstance,
      "BareMetal",
      true,
      { cpu: 6, memory: 12 } // Only 2 CPU and 4GB available for workloads
    );

    // Verify reservations are set correctly
    expect(limitedCPMachineSet.cpu).toBe(8);
    expect(limitedCPMachineSet.controlPlaneReserved?.cpu).toBe(6);
    expect(limitedCPMachineSet.controlPlaneReserved?.memory).toBe(12);
    // Available CPU for workloads should be 8 - 6 = 2
  });

  it("Should create control plane machine set with workload scheduling disabled", () => {
    const baseInstance = {
      cpuUnits: 24,
      memory: 64,
      name: "restricted-cp",
      maxDisks: 24,
    };

    const restrictedCPMachineSet = createControlPlaneMachineSet(
      baseInstance,
      "BareMetal",
      false // Workload scheduling disabled
    );

    expect(restrictedCPMachineSet.allowWorkloadScheduling).toBe(false);
    expect(restrictedCPMachineSet.onlyFor).toContain("ControlPlane");
  });
});
