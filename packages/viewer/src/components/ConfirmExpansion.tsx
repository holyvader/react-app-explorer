import { Button, HStack, Modal, Text } from "@rae/design-system";
import { useExplorer } from "../store.ts";

export function ConfirmExpansion() {
  const pending = useExplorer((s) => s.pending);
  const { confirmPending, cancelPending } = useExplorer.getState();
  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => !o && cancelPending()}
      title="Large expansion"
      size="sm"
      footer={
        <HStack>
          <Button variant="outline" onClick={cancelPending}>
            Cancel
          </Button>
          <Button onClick={confirmPending}>Add {pending?.ids.length} nodes</Button>
        </HStack>
      }
    >
      <Text>
        {pending?.label} adds <b>{pending?.ids.length}</b> nodes to the diagram. Rendering may get slow. Tip: disable
        edge groups (e.g. Imports) in the toolbar to narrow the expansion.
      </Text>
    </Modal>
  );
}
