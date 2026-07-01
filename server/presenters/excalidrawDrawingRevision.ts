import type ExcalidrawDrawingRevision from "@server/models/ExcalidrawDrawingRevision";

/**
 * Presents an Excalidraw drawing revision for API responses.
 *
 * @param revision - the drawing revision to present.
 * @return the serialized drawing revision.
 */
export default function presentExcalidrawDrawingRevision(
  revision: ExcalidrawDrawingRevision
) {
  return {
    id: revision.id,
    drawingId: revision.drawingId,
    documentId: revision.documentId,
    scene: revision.scene,
    preview: revision.preview,
    createdAt: revision.createdAt,
    createdById: revision.createdById,
  };
}
