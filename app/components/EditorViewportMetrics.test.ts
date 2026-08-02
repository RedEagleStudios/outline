import Analytics from "~/utils/Analytics";
import {
  bucketViewportMetric,
  bucketViewportDocumentSize,
  bucketViewportLifetime,
  bucketViewportMaxLeased,
  trackViewportMetricsSummary,
} from "./EditorViewportMetrics";

describe("EditorViewportMetrics", () => {
  it.each([
    [-1, "0"],
    [0, "0"],
    [1, "1"],
    [2, "2-4"],
    [4, "2-4"],
    [5, "5-8"],
    [8, "5-8"],
    [9, "9-16"],
    [16, "9-16"],
    [17, "17-32"],
    [32, "17-32"],
    [33, "33+"],
  ])("buckets %s as %s", (value, expected) => {
    expect(bucketViewportMetric(value)).toBe(expected);
  });

  it.each([
    [0, "<10s"],
    [9_999, "<10s"],
    [10_000, "10-59s"],
    [59_999, "10-59s"],
    [60_000, "1-4m"],
    [299_999, "1-4m"],
    [300_000, "5-29m"],
    [1_799_999, "5-29m"],
    [1_800_000, "30m+"],
  ])("buckets lifetime %s as %s", (value, expected) => {
    expect(bucketViewportLifetime(value)).toBe(expected);
  });

  it.each([
    [0, "<1k"],
    [999, "<1k"],
    [1_000, "1k-9,999"],
    [9_999, "1k-9,999"],
    [10_000, "10k-49,999"],
    [49_999, "10k-49,999"],
    [50_000, "50k+"],
  ])("buckets document size %s as %s", (value, expected) => {
    expect(bucketViewportDocumentSize(value)).toBe(expected);
  });

  it("reports lease overflow honestly", () => {
    expect(bucketViewportMaxLeased(8)).toBe("8");
    expect(bucketViewportMaxLeased(9)).toBe("9+");
  });

  it("emits only allowlisted string metadata", () => {
    const track = jest.spyOn(Analytics, "track").mockImplementation();
    trackViewportMetricsSummary(
      {
        documentSize: 100,
        membersRegistered: 1,
        leaseGrants: 2,
        pressureEvictionRequests: 3,
        leaseReleases: 4,
        pins: 5,
        gatedIframeEntries: 6,
        gatedIframeExits: 7,
        maxFrameCandidates: 8,
        maxLeased: 20,
        maxQueued: 9,
        maxPinned: 10,
        maxGatedIframes: 11,
      },
      "unmount",
      1000
    );
    expect(track).toHaveBeenCalledWith(
      "editor_performance",
      "viewport_gated_embeds_summary",
      expect.objectContaining({
        schema_version: "1",
        surface: "document",
        end_reason: "unmount",
        max_leased: "9+",
      })
    );
    const metadata = track.mock.calls[0][2];
    expect(Object.keys(metadata ?? {}).sort()).toEqual(
      [
        "document_size_bucket",
        "end_reason",
        "frame_candidate_count_bucket",
        "gated_iframe_entries",
        "gated_iframe_exits",
        "lease_grants",
        "lease_releases",
        "lifetime_bucket",
        "max_gated_iframes",
        "max_leased",
        "max_pinned",
        "max_queued",
        "members_registered",
        "pins",
        "pressure_eviction_requests",
        "schema_version",
        "surface",
      ].sort()
    );
    expect(
      Object.values(metadata ?? {}).every((value) => typeof value === "string")
    ).toBe(true);
  });
});
