import * as React from "react";
import { useDispatch, useSelector } from "react-redux";
import { Instance, MachineSet } from "../../types";
import {
  removeAllNodes,
  removeAllZones,
  Store,
  updateMachineSet,
} from "../../redux";
import {
  Modal,
  Form,
  FormGroup,
  SelectOption,
  Select,
  SelectVariant,
  Button,
  SelectOptionObject,
  Checkbox,
  TextInput,
} from "@patternfly/react-core";
import { platformInstanceMap } from "../../cloudInstance";
import * as _ from "lodash";
import { InstancePlanner } from "./Common";
import { isCloudPlatform as affirmCloudPlatform } from "../../utils";

type WorkloadEditModalProps = {
  machineSet: MachineSet;
  onClose: any;
};

const MachineSetEditModal: React.FC<WorkloadEditModalProps> = ({
  machineSet,
  onClose: closeModal,
}) => {
  const dispatch = useDispatch();

  const { machines, workloads, platform } = useSelector((store: Store) => ({
    machines: store.machineSet,
    workloads: store.workload,
    platform: store.cluster.platform,
  }));

  const [dedicated, setDedicated] = React.useState(machineSet.onlyFor);
  const [isOpen, setOpen] = React.useState(false);
  const [selectedInstance, setInstance] = React.useState<string>(
    machineSet.instanceName
  );
  const [cpu, setCPU] = React.useState(machineSet.cpu);
  const [memory, setMem] = React.useState(machineSet.memory);
  const isCloudPlatform = affirmCloudPlatform(platform);

  // Control plane scheduling state
  const [allowWorkloadScheduling, setAllowWorkloadScheduling] = React.useState(
    machineSet.allowWorkloadScheduling ?? false
  );
  const [reservedCPU, setReservedCPU] = React.useState(
    machineSet.controlPlaneReserved?.cpu ?? 2
  );
  const [reservedMemory, setReservedMemory] = React.useState(
    machineSet.controlPlaneReserved?.memory ?? 4
  );

  const workloadOptions = React.useMemo(
    () =>
      workloads.map((workload) => {
        return <SelectOption value={workload.name} key={workload.name} />;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(machines)]
  );

  const onSelectMachines = (_event: any, workload: SelectOptionObject) => {
    if (dedicated.includes(workload as string)) {
      const updatedWorkloads = dedicated.filter((m) => m !== workload);
      setDedicated(updatedWorkloads);
    } else {
      setDedicated([...dedicated, workload as string]);
    }
  };

  const updateMS = () => {
    const instance = _.find<Instance>(
      platformInstanceMap[platform],
      (item) => item.name === selectedInstance
    );
    const isControlPlane = machineSet.name === "controlPlane";

    const updateMS = Object.assign({}, machineSet, {
      onlyFor: dedicated,
      instanceName: selectedInstance,
      cpu: isCloudPlatform ? instance.cpuUnits : cpu,
      memory: isCloudPlatform ? instance.memory : memory,
      instanceStorage: isCloudPlatform
        ? instance.instanceStorage
        : machineSet.instanceStorage,
      numberOfDisks: isCloudPlatform
        ? instance.maxDisks
        : machineSet.numberOfDisks,
      // Add control plane scheduling configuration
      allowWorkloadScheduling: isControlPlane
        ? allowWorkloadScheduling
        : undefined,
      controlPlaneReserved: isControlPlane
        ? {
            cpu: reservedCPU,
            memory: reservedMemory,
          }
        : undefined,
    });
    dispatch(updateMachineSet(updateMS));
    dispatch(removeAllNodes());
    dispatch(removeAllZones());
    closeModal();
  };

  return (
    <Modal
      height="80vh"
      width="40vw"
      className="ms-modal"
      isOpen={true}
      onClose={() => closeModal()}
      title="Edit Machine Set"
      actions={[
        <Button
          key="save"
          variant="primary"
          onClick={updateMS}
          isDisabled={!selectedInstance}
        >
          Save
        </Button>,
        <Button key="cancel" variant="secondary" onClick={() => closeModal()}>
          Cancel
        </Button>,
      ]}
    >
      <Form>
        <InstancePlanner
          cpu={cpu}
          setCPU={setCPU}
          memory={memory}
          setMemory={setMem}
          instance={selectedInstance}
          setInstance={setInstance}
        />
        <FormGroup label="Dedicate to Workload" fieldId="dedicated-workloads">
          <Select
            variant={SelectVariant.checkbox}
            isOpen={isOpen}
            onToggle={() => setOpen((o) => !o)}
            onClear={() => setDedicated([])}
            selections={dedicated}
            onSelect={onSelectMachines}
          >
            {workloadOptions}
          </Select>
        </FormGroup>

        {/* Control Plane Scheduling Options - only show if this is the control plane machine set */}
        {machineSet.name === "controlPlane" && (
          <>
            <FormGroup
              label="Control Plane Scheduling"
              fieldId="control-plane-scheduling"
            >
              <Checkbox
                id="allow-workload-scheduling-edit"
                label="Allow workload scheduling on control plane nodes"
                description="Enable this to allow user workloads to be scheduled on control plane nodes. Control plane services will be prioritized."
                isChecked={allowWorkloadScheduling}
                onChange={(checked) => setAllowWorkloadScheduling(checked)}
              />
            </FormGroup>

            {allowWorkloadScheduling && (
              <>
                <FormGroup
                  label="Reserved CPU for Control Plane"
                  fieldId="reserved-cpu-edit"
                  helperText="CPU cores reserved for control plane services"
                >
                  <TextInput
                    id="reserved-cpu-edit"
                    type="number"
                    value={reservedCPU}
                    onChange={(val) => setReservedCPU(parseInt(val) || 2)}
                    min={1}
                    max={cpu - 1}
                  />
                </FormGroup>

                <FormGroup
                  label="Reserved Memory for Control Plane (GB)"
                  fieldId="reserved-memory-edit"
                  helperText="Memory reserved for control plane services"
                >
                  <TextInput
                    id="reserved-memory-edit"
                    type="number"
                    value={reservedMemory}
                    onChange={(val) => setReservedMemory(parseInt(val) || 4)}
                    min={1}
                    max={memory - 1}
                  />
                </FormGroup>
              </>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
};

export default MachineSetEditModal;
