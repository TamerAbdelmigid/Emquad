/** `run`, made so that calls while it runs make one more run after it, however many they are. */
export function coalesced(run: () => Promise<unknown>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const go = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await run();
      } while (again);
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  };
  return go;
}
