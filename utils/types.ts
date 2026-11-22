export type ObservationSource = 'webRequest' | 'dom_mutation';

export interface TelemetryArtifact {
  id: string;                 // Unique key used to prevent duplicate records (FR-03)
  timestamp: string;          // ISO-8601 time of capture
  source: ObservationSource;  // Whether caught via network listener or DOM observer
  targetPageUrl: string;      // The website being analyzed
  initiatorUrl: string;       // The parent page or script that triggered this request (FR-12)
  normalizedUrl: string;      // Clean URL with query strings stripped (FR-02)
  destinationDomain: string;  // Domain name (e.g., google-analytics.com)
  resourceType: string;       // script, xmlhttprequest, tracking_pixel, image, sub_frame
  isThirdParty: boolean;      // True if domain differs from the target site (FR-04)
  hasIntegrityAttr?: boolean; // Checks if <script> uses Subresource Integrity (SRI)
}

export interface AnalysisSession {
  sessionId: string;
  tabId: number;
  targetOrigin: string;
  targetFullUrl: string;
  startedAt: string;
  status: 'recording' | 'submitting';
  artifacts: Record<string, TelemetryArtifact>; // Stored as a dictionary for fast deduplication
  rawEventCount: number;
}