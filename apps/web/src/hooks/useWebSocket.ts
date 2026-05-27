'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsEvent, ArbitrageOpportunity, ScannerStatus, LiveMatch, LiveArbitrageOpportunity } from '@arbix/shared';
import { useOpportunityStore, useNotificationStore } from '@/store';
import { getAccessToken } from '@/lib/auth';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_DELAY_MS = 1000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);

  const {
    addOrUpdateOpportunity,
    removeOpportunity,
    setScannerStatus,
    setConnectionStatus,
    setLiveMatch,
    setLiveArbitrageOpportunity,
    setGamesData,
  } = useOpportunityStore();
  const { addNotification } = useNotificationStore();

  const connectionStatus = useOpportunityStore((s) => s.connectionStatus);

  const pushBrowserNotif = useCallback((title: string, body: string, tag: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico', tag });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body, icon: '/favicon.ico', tag });
      });
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    reconnectTimeoutRef.current = null;
    pingIntervalRef.current = null;
  }, []);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;

    setConnectionStatus('connecting');

    const wsUrl = `${WS_URL}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setConnectionStatus('connected');

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
        }
      }, 30000);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data: WsEvent = JSON.parse(event.data as string);
        setLastEvent(data);

        switch (data.type) {
          case 'opportunity:new': {
            const opportunity = data.payload as ArbitrageOpportunity;
            addOrUpdateOpportunity(opportunity);
            addNotification({
              type: 'opportunity',
              title: 'New Arbitrage Found',
              message: `${opportunity.eventName} — ${opportunity.roi.toFixed(2)}% ROI`,
              opportunityId: opportunity.id,
            });
            pushBrowserNotif('⚡ New Arbitrage Found', `${opportunity.eventName} — ${opportunity.roi.toFixed(2)}% ROI`, opportunity.id);
            break;
          }

          case 'opportunity:updated': {
            const opportunity = data.payload as ArbitrageOpportunity;
            addOrUpdateOpportunity(opportunity);
            break;
          }

          case 'opportunity:expired': {
            const { id } = data.payload as { id: string };
            removeOpportunity(id);
            break;
          }

          case 'scanner:status': {
            const status = data.payload as ScannerStatus;
            setScannerStatus(status);
            break;
          }

          case 'live:match': {
            setLiveMatch(data.payload as LiveMatch);
            break;
          }

          case 'live:opportunity': {
            const liveOpp = data.payload as LiveArbitrageOpportunity;
            setLiveArbitrageOpportunity(liveOpp);
            addNotification({
              type: 'opportunity',
              title: 'Live Arb Detected',
              message: `${liveOpp.eventName} — ${liveOpp.roi.toFixed(2)}% ROI (${liveOpp.gameStatus})`,
              opportunityId: liveOpp.id,
            });
            pushBrowserNotif('🔴 Live Arb Detected!', `${liveOpp.eventName} — ${liveOpp.roi.toFixed(2)}% ROI · ${liveOpp.gameStatus}`, liveOpp.id);
            break;
          }

          case 'games:update': {
            const games = data.payload as any[];
            if (Array.isArray(games)) setGamesData(games);
            break;
          }

          case 'pong':
            break;

          default:
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      clearTimers();
      setConnectionStatus('disconnected');

      if (event.code !== 1000 && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.current),
          30000,
        );
        reconnectAttempts.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      setConnectionStatus('error');
      ws.close();
    };
  }, [addOrUpdateOpportunity, removeOpportunity, setScannerStatus, setConnectionStatus, addNotification, clearTimers, setLiveMatch, setLiveArbitrageOpportunity, setGamesData, pushBrowserNotif]);

  const disconnect = useCallback(() => {
    clearTimers();
    reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, [clearTimers, setConnectionStatus]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected: connectionStatus === 'connected',
    connectionStatus,
    lastEvent,
    reconnect: connect,
    disconnect,
  };
}
