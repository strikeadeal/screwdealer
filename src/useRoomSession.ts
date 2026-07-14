import { useCallback, useEffect, useRef, useState } from "react";
import {
  ServerMessageSchema,
  type ClientCommand,
  type PublicRoomSnapshot,
  type SessionCredentials,
} from "../shared/protocol";
import { API_URL } from "./api";
import { clearSession, saveSession, socketUrl } from "./session";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

type CommandType = ClientCommand["type"];

export function useRoomSession(initialCredentials: SessionCredentials | null) {
  const [credentials, setCredentials] = useState<SessionCredentials | null>(initialCredentials);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(initialCredentials ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const snapshotRef = useRef<PublicRoomSnapshot | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!credentials) return;
    const session = credentials;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    let lastPong = Date.now();

    function connect() {
      if (cancelled) return;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const socket = new WebSocket(socketUrl(API_URL, session));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attempt = 0;
        lastPong = Date.now();
        setStatus("connected");
        setError(null);
      });
      socket.addEventListener("message", (event) => {
        if (event.data === "pong") {
          lastPong = Date.now();
          return;
        }
        try {
          const message = ServerMessageSchema.parse(JSON.parse(String(event.data)));
          if (message.type === "snapshot") {
            setSnapshot(message.snapshot);
            setError(null);
          } else {
            setError(message.message);
            if (message.snapshot) setSnapshot(message.snapshot);
          }
        } catch {
          setError("The room sent an unreadable update. Reconnecting…");
          socket.close(4002, "Protocol error");
        }
      });
      socket.addEventListener("close", (event) => {
        if (cancelled) return;
        if (event.code === 4004) {
          clearSession(session.roomCode);
          setError("This room has expired.");
          setCredentials(null);
          setSnapshot(null);
          setStatus("idle");
          return;
        }
        attempt += 1;
        setStatus(navigator.onLine ? "reconnecting" : "offline");
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 250);
        retryTimer = window.setTimeout(connect, delay);
      });
    }

    function onOnline() {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        setStatus("connected");
        socket.send("ping");
        return;
      }
      if (socket?.readyState === WebSocket.CONNECTING) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      connect();
    }
    function onOffline() {
      setStatus("offline");
    }
    function onVisibility() {
      if (document.visibilityState === "visible" && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send("ping");
      }
    }

    connect();
    const heartbeatTimer = window.setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPong > 55_000) socket.close(4000, "Heartbeat timeout");
      else socket.send("ping");
    }, 25_000);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      socketRef.current?.close(1000, "Session changed");
      socketRef.current = null;
    };
  }, [credentials]);

  const begin = useCallback((next: SessionCredentials) => {
    saveSession(next);
    setCredentials(next);
    setSnapshot(null);
    setStatus("connecting");
    setError(null);
  }, []);

  const command = useCallback((type: CommandType, payload: ClientCommand["payload"]) => {
    const socket = socketRef.current;
    const current = snapshotRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !current) {
      setError("Still reconnecting. Your action was not sent.");
      return;
    }
    socket.send(
      JSON.stringify({
        version: 1,
        commandId: crypto.randomUUID(),
        expectedRevision: current.revision,
        type,
        payload,
      }),
    );
  }, []);

  const forget = useCallback(() => {
    if (credentials) clearSession(credentials.roomCode);
    socketRef.current?.close(1000, "Left room");
    setCredentials(null);
    setSnapshot(null);
    setStatus("idle");
  }, [credentials]);

  return { credentials, snapshot, status, error, begin, command, forget, setError };
}
