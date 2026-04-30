import { useEffect, useRef, useState } from "react";

export interface SocketEvent {
  event: string;
  data: unknown;
  at: number;
}

type Handler = (e: SocketEvent) => void;

let sharedWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;
const handlers = new Set<Handler>();
const connectionListeners = new Set<(connected: boolean) => void>();

function emitConnected(connected: boolean) {
  for (const listener of connectionListeners) listener(connected);
}

function socketUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function connect() {
  if (sharedWs && (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  sharedWs = new WebSocket(socketUrl());
  sharedWs.onopen = () => emitConnected(true);
  sharedWs.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data) as SocketEvent;
      for (const handler of handlers) handler(parsed);
    } catch {
      /* ignore */
    }
  };
  sharedWs.onerror = () => {
    // Let onclose schedule reconnect. Don't log noisy transient dev errors.
    if (sharedWs?.readyState === WebSocket.OPEN) sharedWs.close();
  };
  sharedWs.onclose = () => {
    emitConnected(false);
    sharedWs = null;
    if (subscriberCount > 0 && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    }
  };
}

function releaseSocketSoon() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (subscriberCount > 0) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sharedWs.close();
    }
    // If CONNECTING, don't call close(); browsers log
    // "WebSocket is closed before the connection is established".
    sharedWs = null;
    emitConnected(false);
  }, 750);
}

export function useSocket(onEvent?: (e: SocketEvent) => void) {
  const [connected, setConnected] = useState(
    () => sharedWs?.readyState === WebSocket.OPEN,
  );
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    subscriberCount += 1;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    const eventHandler: Handler = (event) => handlerRef.current?.(event);
    handlers.add(eventHandler);
    connectionListeners.add(setConnected);
    connect();

    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      handlers.delete(eventHandler);
      connectionListeners.delete(setConnected);
      releaseSocketSoon();
    };
  }, []);

  return { connected };
}
