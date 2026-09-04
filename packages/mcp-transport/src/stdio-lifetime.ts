export function installStdioLifetime(options: {
  stdin: NodeJS.ReadableStream;
  process?: NodeJS.Process;
  onHangup: (reason: string) => void | Promise<void>;
}): () => void {
  let done = false;
  const hangup = (reason: string) => {
    if (done) return;
    done = true;
    void options.onHangup(reason);
  };
  const onEnd = () => hangup("stdin-end");
  const onClose = () => hangup("stdin-close");
  options.stdin.once("end", onEnd);
  options.stdin.once("close", onClose);
  const proc = options.process;
  const onSigint = () => hangup("SIGINT");
  const onSigterm = () => hangup("SIGTERM");
  proc?.once("SIGINT", onSigint);
  proc?.once("SIGTERM", onSigterm);
  return () => {
    options.stdin.off("end", onEnd);
    options.stdin.off("close", onClose);
    proc?.off("SIGINT", onSigint);
    proc?.off("SIGTERM", onSigterm);
  };
}
