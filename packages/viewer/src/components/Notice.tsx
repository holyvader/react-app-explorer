import { Alert, Box } from "@rae/design-system";
import { useExplorer } from "../store.ts";

/** A short message at the bottom of the canvas (store `notice`); click to dismiss. */
export function Notice() {
  const notice = useExplorer((s) => s.notice);
  if (!notice) return null;
  return (
    <Box position="absolute" bottom="24" left="50%" transform="translateX(-50%)" zIndex="1300" maxW="520px" onClick={() => useExplorer.getState().notify(undefined)} cursor="pointer">
      <Alert status="warning" title={notice} />
    </Box>
  );
}
