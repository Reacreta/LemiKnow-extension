import { useEffect, useState } from 'react';
import type { AnalysisSession, TelemetryArtifact } from '../../utils/types';
import './style.css';

interface TelemetryPayload {
  session_id: string;
  target_url: string;
  started_at: string;
  ended_at: string;
  raw_event_count: number;
  artifacts: TelemetryArtifact[];
}

export default function App() {
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedAnalysisId, setCompletedAnalysisId] = useState<string | null>(null);
  const [exportedPayload, setExportedPayload] = useState<TelemetryPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      const data = await chrome.storage.session.get('active_lemiknow_session');
      setSession((data.active_lemiknow_session as AnalysisSession | undefined) ?? null);
    };

    void loadSession();

    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === 'session' && changes.active_lemiknow_session) {
        setSession(
          (changes.active_lemiknow_session.newValue as AnalysisSession | undefined) ?? null
        );
      }
    };

    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  const handleStart = async () => {
    setError(null);
    setNotice(null);
    setCompletedAnalysisId(null);
    setExportedPayload(null);

    try {
      const res = await chrome.runtime.sendMessage({ type: 'START_SESSION' });
      if (!res?.ok) {
        setError(res?.error || 'Could not start session.');
      } else if (res.session) {
        setSession(res.session as AnalysisSession);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not contact the extension background.');
    }
  };

  const handleStopAndSubmit = () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    chrome.runtime.sendMessage({ type: 'STOP_AND_SUBMIT' }, (res) => {
      setIsSubmitting(false);

      if (!res?.ok) {
        setError(res?.error || 'Failed to stop telemetry session.');
        return;
      }

      setSession(null);
      setExportedPayload((res.payload as TelemetryPayload) ?? null);

      if (res.offline) {
        setNotice(res.warning || 'Session stopped. Download your captured JSON below.');
      } else {
        setCompletedAnalysisId(res.analysisId as string);
      }
    });
  };

  const handleDiscard = () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_SESSION' }, () => {
      setSession(null);
      setExportedPayload(null);
      setNotice(null);
      setError(null);
    });
  };

  const downloadJson = () => {
    if (!exportedPayload) return;
    const blob = new Blob([JSON.stringify(exportedPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lemiknow-telemetry-${exportedPayload.session_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uniqueArtifacts = session ? Object.values(session.artifacts) : [];
  const thirdPartyCount = uniqueArtifacts.filter((item) => item.isThirdParty).length;
  const isFinished = Boolean(completedAnalysisId || exportedPayload);

  return (
    <div className="container">
      <div className="header">
        <h1>LemiKnow Sensor</h1>
        <p>Client-Side Data Lineage & Third-Party Risk</p>
      </div>

      {error && <div className="alert">{error}</div>}

      {/* STATE 1: Ready to start */}
      {!session && !isFinished && (
        <div>
          <div className="card">
            <span className="card-title">Privacy & Data Minimization (RA 10173)</span>
            LemiKnow passively records outgoing URLs, script origins, and resource types on this
            tab only during an active scan. Passwords, cookies, and form inputs are never read.
          </div>

          <label className="consent-row">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
            />
            <span>I consent to passive observation for this browser tab session.</span>
          </label>

          <button
            className="btn btn-primary"
            disabled={!consentAccepted}
            onClick={handleStart}
          >
            Start Website Analysis
          </button>
        </div>
      )}

      {/* STATE 2: Actively recording */}
      {session && (
        <div>
          <div className="card">
            <div className="badge-rec">● Recording Active Session</div>
            <div className="url-text">{session.targetOrigin}</div>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <div className="stat-value">{uniqueArtifacts.length}</div>
              <div className="stat-label">Unique Artifacts</div>
            </div>
            <div className="stat-box">
              <div className="stat-value warn">{thirdPartyCount}</div>
              <div className="stat-label">3rd-Party Endpoints</div>
            </div>
          </div>

          <button
            className="btn btn-danger"
            disabled={isSubmitting}
            onClick={handleStopAndSubmit}
          >
            {isSubmitting ? 'Stopping...' : 'Stop & Analyze Telemetry'}
          </button>

          <button className="btn btn-secondary" onClick={handleDiscard}>
            Discard Session
          </button>
        </div>
      )}

      {/* STATE 3: Session finished (Online or Offline JSON export) */}
      {!session && isFinished && (
        <div>
          <div className="success-box">
            <strong>{completedAnalysisId ? 'Analysis Complete!' : 'Session Captured!'}</strong>
            <p style={{ marginTop: '4px' }}>
              {notice || 'Telemetry was normalized and sent to the LemiKnow backend.'}
            </p>
          </div>

          {completedAnalysisId && (
            <a
              href={`/analyses/${completedAnalysisId}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <button className="btn btn-primary">Open Risk-Weighted Node Map</button>
            </a>
          )}

          {exportedPayload && (
            <button className="btn btn-primary" onClick={downloadJson}>
              Download Captured JSON ({exportedPayload.artifacts.length} items)
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => {
              setCompletedAnalysisId(null);
              setExportedPayload(null);
              setNotice(null);
            }}
          >
            Start Another Scan
          </button>
        </div>
      )}
    </div>
  );
}