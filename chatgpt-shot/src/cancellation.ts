export type SignalHost = Pick<NodeJS.Process, 'on' | 'off' | 'exit'>;

export function installCancellationHandler(
  close: () => Promise<void>,
  host: SignalHost = process,
): () => void {
  let exiting = false;
  const cancel = (signal: 'SIGINT' | 'SIGTERM') => {
    if (exiting) return;
    exiting = true;
    void close().finally(() => host.exit(signal === 'SIGINT' ? 130 : 143));
  };

  const onSigint = () => cancel('SIGINT');
  const onSigterm = () => cancel('SIGTERM');
  host.on('SIGINT', onSigint);
  host.on('SIGTERM', onSigterm);
  return () => {
    host.off('SIGINT', onSigint);
    host.off('SIGTERM', onSigterm);
  };
}
