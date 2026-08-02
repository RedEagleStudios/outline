import Analytics from "~/utils/Analytics";
import type { ViewportResourceMetricsSummary } from "@shared/editor/components/hooks/viewportResourceMetrics";

/** Allowed reasons that an enabled editor metrics lifetime ended. */
export type ViewportMetricsEndReason = "live_disable" | "unmount" | "pagehide";

/**
 * Deterministically buckets an unbounded non-negative count.
 *
 * @param value - count to bucket.
 * @returns the fixed privacy-preserving bucket.
 */
export function bucketViewportMetric(value: number): string {
  if (value <= 0) {
    return "0";
  }
  if (value === 1) {
    return "1";
  }
  if (value <= 4) {
    return "2-4";
  }
  if (value <= 8) {
    return "5-8";
  }
  if (value <= 16) {
    return "9-16";
  }
  if (value <= 32) {
    return "17-32";
  }
  return "33+";
}

/**
 * Returns a privacy-safe enabled-editor lifetime bucket.
 *
 * @param milliseconds - enabled lifetime in milliseconds.
 * @returns the fixed lifetime bucket.
 */
export function bucketViewportLifetime(milliseconds: number): string {
  if (milliseconds < 10_000) {
    return "<10s";
  }
  if (milliseconds < 60_000) {
    return "10-59s";
  }
  if (milliseconds < 300_000) {
    return "1-4m";
  }
  if (milliseconds < 1_800_000) {
    return "5-29m";
  }
  return "30m+";
}

/**
 * Returns a privacy-safe ProseMirror document-size bucket.
 *
 * @param size - ProseMirror document content size.
 * @returns the fixed document-size bucket.
 */
export function bucketViewportDocumentSize(size: number): string {
  if (size < 1_000) {
    return "<1k";
  }
  if (size < 10_000) {
    return "1k-9,999";
  }
  if (size < 50_000) {
    return "10k-49,999";
  }
  return "50k+";
}

/**
 * Returns the exact bounded lease peak or an explicit overflow bucket.
 *
 * @param value - observed maximum lease count.
 * @returns an exact value from zero through eight, or nine-plus.
 */
export function bucketViewportMaxLeased(value: number): string {
  return value > 8 ? "9+" : String(Math.max(0, value));
}

/**
 * Emits one privacy-bounded analytics summary when the collector finishes.
 *
 * @param summary - immutable neutral metrics summary.
 * @param endReason - first reason the metrics lifetime ended.
 * @param lifetimeMilliseconds - elapsed enabled lifetime in milliseconds.
 * @returns nothing.
 */
export function trackViewportMetricsSummary(
  summary: ViewportResourceMetricsSummary,
  endReason: ViewportMetricsEndReason,
  lifetimeMilliseconds: number
): void {
  try {
    Analytics.track("editor_performance", "viewport_gated_embeds_summary", {
      schema_version: "1",
      surface: "document",
      end_reason: endReason,
      lifetime_bucket: bucketViewportLifetime(lifetimeMilliseconds),
      document_size_bucket: bucketViewportDocumentSize(summary.documentSize),
      frame_candidate_count_bucket: bucketViewportMetric(
        summary.maxFrameCandidates
      ),
      members_registered: bucketViewportMetric(summary.membersRegistered),
      lease_grants: bucketViewportMetric(summary.leaseGrants),
      pressure_eviction_requests: bucketViewportMetric(
        summary.pressureEvictionRequests
      ),
      lease_releases: bucketViewportMetric(summary.leaseReleases),
      pins: bucketViewportMetric(summary.pins),
      gated_iframe_entries: bucketViewportMetric(summary.gatedIframeEntries),
      gated_iframe_exits: bucketViewportMetric(summary.gatedIframeExits),
      max_leased: bucketViewportMaxLeased(summary.maxLeased),
      max_queued: bucketViewportMetric(summary.maxQueued),
      max_pinned: bucketViewportMetric(summary.maxPinned),
      max_gated_iframes: bucketViewportMetric(summary.maxGatedIframes),
    });
  } catch (_error) {
    // Analytics is best-effort and must not affect editor teardown.
  }
}
