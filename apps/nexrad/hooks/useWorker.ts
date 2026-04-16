"use client";

import { useCallback, useEffect, useRef } from "react";

export function useWorker<TRequest, TResult>(
  factory: () => Worker,
  onResult: (result: TResult) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const worker = factory();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<TResult>) => {
      onResultRef.current(event.data);
    };

    worker.onerror = (err) => {
      console.error("[useWorker] error:", err);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [factory]);

  const postMessage = useCallback(
    (message: TRequest, transfer?: Transferable[]) => {
      workerRef.current?.postMessage(message, transfer ?? []);
    },
    []
  );

  return { postMessage };
}
