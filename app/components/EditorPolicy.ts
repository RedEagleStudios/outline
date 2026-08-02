/**
 * Determines whether viewport-gated embeds are effective for an editor.
 *
 * @param eligible Whether the editor surface is eligible.
 * @param globallyEnabled Whether the global control is enabled.
 * @param shareId The active public share identifier, if any.
 * @returns whether viewport-gated embeds should be enabled.
 */
export function shouldEnableViewportGatedEmbeds(
  eligible: boolean | undefined,
  globallyEnabled: boolean,
  shareId: string | undefined
): boolean {
  return eligible === true && globallyEnabled && !shareId;
}
