"use client";

import { useCallback, useEffect, useRef } from "react";

export function useWorker<TRequest, TResult>(
  factory: () => Worker,
  onResult: (result: TResult) => void,
  onError?: (err: ErrorEvent) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Capture factory on first render only — worker URL is stable by definition
  const factoryRef = useRef(factory);

  useEffect(() => {
    const worker = factoryRef.current();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<TResult>) => {
      onResultRef.current(event.data);
    };

    worker.onerror = (err) => {
      console.error("[useWorker] fatal worker error:", err);
      workerRef.current = null;
      onErrorRef.current?.(err);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const postMessage = useCallback(
    (message: TRequest, transfer?: Transferable[]) => {
      workerRef.current?.postMessage(message, transfer ?? []);
    },
    []
  );

  return { postMessage };
}
