import { Button, HStack, Modal, Text } from "@rae/design-system";
import { useExplorer } from "../store.ts";

export function ConfirmExpansion() {
  const pending = useExplorer((s) => s.pending);
  const confirmAbove = useExplorer((s) => s.confirmAbove);
  const { confirmPending, cancelPending } = useExplorer.getState();
  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => !o && cancelPending()}
      title="Add this many?"
      size="sm"
      footer={
        <HStack>
          <Button variant="outline" onClick={cancelPending}>
            Cancel
          </Button>
          <Button colorPalette="accent" onClick={confirmPending}>Add {pending?.ids.length} elements</Button>
        </HStack>
      }
    >
      <Text>
        {pending?.label} adds <b>{pending?.ids.length}</b> elements to the diagram, more than the {confirmAbove} you're asked about (Settings → Ask before
        adding more than). Big diagrams lay out and move slowly. To add fewer, turn off some relations (e.g. Imports) in the status bar first.
      </Text>
    </Modal>
  );
}
