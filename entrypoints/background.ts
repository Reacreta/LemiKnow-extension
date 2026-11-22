import type { AnalysisSession, TelemetryArtifact } from '../utils/types';
import { sanitizeUrl, isExternalDomain } from '../utils/sanitizer';

const API_BASE_URL = 'http://localhost:8000/api/v1';
const SESSION_KEY = 'active_lemiknow_session';

// In-memory cache + write queue prevents concurrent webRequests from overwriting each other
let cachedSession: AnalysisSession | null | undefined = undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function getActiveSession(): Promise<AnalysisSession | null> {
  if (cachedSession !== undefined) {
    return cachedSession;
  }
  const data = await chrome.storage.session.get(SESSION_KEY);
  cachedSession = (data[SESSION_KEY] as AnalysisSession | undefined) ?? null;
  return cachedSession;
}

function scheduleSessionPersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (cachedSession) {
      await chrome.storage.session.set({ [SESSION_KEY]: cachedSession });
    }
  }, 150);
}

export default defineBackground(() => {
  // 1. Passive Network Request Listener (Non-blocking, no requestBody captured)
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return undefined;

      void (async () => {
        const session = await getActiveSession();
        if (!session || session.status !== 'recording' || session.tabId !== details.tabId) {
          return;
        }

        const cleanDest = sanitizeUrl(details.url);
        if (!cleanDest) return;

        const cleanInitiator = details.initiator
          ? sanitizeUrl(details.initiator)?.normalizedUrl ?? session.targetFullUrl
          : session.targetFullUrl;

        const targetHost = new URL(session.targetOrigin).hostname;
        const isThirdParty = isExternalDomain(targetHost, cleanDest.domain);
        const dedupeKey = `webRequest|${cleanInitiator}|${cleanDest.normalizedUrl}|${details.type}`;

        session.rawEventCount += 1;

        if (!session.artifacts[dedupeKey]) {
          const artifact: TelemetryArtifact = {
            id: dedupeKey,
            timestamp: new Date(details.timeStamp).toISOString(),
            source: 'webRequest',
            targetPageUrl: session.targetFullUrl,
            initiatorUrl: cleanInitiator,
            normalizedUrl: cleanDest.normalizedUrl,
            destinationDomain: cleanDest.domain,
            resourceType: details.type,
            isThirdParty,
          };
          session.artifacts[dedupeKey] = artifact;
        }

        scheduleSessionPersist();
      })();
    },
    { urls: ['<all_urls>'] }
  );

  // 2. Message Listener for Popup & Content Script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void (async () => {
      // Handle DOM events from content.ts
      if (message.type === 'DOM_ARTIFACT') {
        const session = await getActiveSession();
        if (
          session &&
          session.status === 'recording' &&
          sender.tab?.id === session.tabId &&
          message.payload?.url
        ) {
          const cleanDest = sanitizeUrl(message.payload.url);
          if (cleanDest) {
            const targetHost = new URL(session.targetOrigin).hostname;
            const dedupeKey = `dom_mutation|${session.targetFullUrl}|${cleanDest.normalizedUrl}|${message.payload.resourceType}`;

            if (!session.artifacts[dedupeKey]) {
              session.artifacts[dedupeKey] = {
                id: dedupeKey,
                timestamp: new Date().toISOString(),
                source: 'dom_mutation',
                targetPageUrl: session.targetFullUrl,
                initiatorUrl: session.targetFullUrl,
                normalizedUrl: cleanDest.normalizedUrl,
                destinationDomain: cleanDest.domain,
                resourceType: message.payload.resourceType,
                isThirdParty: isExternalDomain(targetHost, cleanDest.domain),
                hasIntegrityAttr: message.payload.hasIntegrityAttr,
              };
              scheduleSessionPersist();
            }
          }
        }
        sendResponse({ ok: true });
        return;
      }

      // User clicked "Start Website Analysis"
      if (message.type === 'START_SESSION') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) {
          sendResponse({ ok: false, error: 'No active web tab found.' });
          return;
        }

        const cleanTarget = sanitizeUrl(tab.url);
        if (!cleanTarget) {
          sendResponse({ ok: false, error: 'Open a regular http:// or https:// website first.' });
          return;
        }

        const newSession: AnalysisSession = {
          sessionId: crypto.randomUUID(),
          tabId: tab.id,
          targetOrigin: new URL(tab.url).origin,
          targetFullUrl: cleanTarget.normalizedUrl,
          startedAt: new Date().toISOString(),
          status: 'recording',
          artifacts: {},
          rawEventCount: 0,
        };

        cachedSession = newSession;
        await chrome.storage.session.set({ [SESSION_KEY]: newSession });
        await chrome.action.setBadgeText({ text: 'REC', tabId: tab.id });
        await chrome.action.setBadgeBackgroundColor({ color: '#DC2626', tabId: tab.id });

        await chrome.tabs.reload(tab.id);
        sendResponse({ ok: true, session: newSession });
        return;
      }

      // User clicked "Stop & Analyze Telemetry"
      if (message.type === 'STOP_AND_SUBMIT') {
        const session = await getActiveSession();
        if (!session) {
          sendResponse({ ok: false, error: 'No active session found.' });
          return;
        }

        const payload = {
          session_id: session.sessionId,
          target_url: session.targetFullUrl,
          started_at: session.startedAt,
          ended_at: new Date().toISOString(),
          raw_event_count: session.rawEventCount,
          artifacts: Object.values(session.artifacts),
        };

        // Stop recording immediately and clear the REC badge
        const tabId = session.tabId;
        cachedSession = null;
        await chrome.storage.session.remove(SESSION_KEY);
        await chrome.action.setBadgeText({ text: '', tabId });

        try {
          const response = await fetch(`${API_BASE_URL}/telemetry/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
          }

          const result = (await response.json()) as { analysis_id: string };
          sendResponse({ ok: true, offline: false, analysisId: result.analysis_id, payload });
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : 'Backend unreachable';
          // Still return ok: true with offline: true so the user can download the JSON file
          sendResponse({
            ok: true,
            offline: true,
            warning: `Recording stopped. FastAPI backend is offline (${reason}), so you can download the JSON below.`,
            payload,
          });
        }
        return;
      }

      // User clicked "Discard Session"
      if (message.type === 'CANCEL_SESSION') {
        const session = await getActiveSession();
        if (session) {
          await chrome.action.setBadgeText({ text: '', tabId: session.tabId });
        }
        cachedSession = null;
        await chrome.storage.session.remove(SESSION_KEY);
        sendResponse({ ok: true });
      }
    })();

    return true;
  });
});