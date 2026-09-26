/**
 * Counts decoded video frames inside the CometChat call container using
 * requestVideoFrameCallback. The meter reports frames alongside time so the
 * receipt can show exactly how much video actually streamed.
 */
export function frameCounter(root: HTMLElement) {
  let pending = 0;
  let total = 0;
  const watched = new WeakSet<HTMLVideoElement>();

  const watch = (v: HTMLVideoElement) => {
    if (watched.has(v) || !("requestVideoFrameCallback" in v)) return;
    watched.add(v);
    const onFrame = () => {
      if (!v.isConnected) return;
      pending++;
      total++;
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  };

  const scan = () => root.querySelectorAll("video").forEach(watch);
  const mo = new MutationObserver(scan);
  mo.observe(root, { childList: true, subtree: true });
  scan();

  return {
    /** frames since the last call */
    take() {
      const n = pending;
      pending = 0;
      return n;
    },
    get total() {
      return total;
    },
    stop() {
      mo.disconnect();
    },
  };
}
