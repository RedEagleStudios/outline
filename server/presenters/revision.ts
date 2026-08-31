import parseTitle from "@shared/utils/parseTitle";
import { traceFunction } from "@server/logging/tracing";
import type { Revision } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import presentUser from "./user";

interface PresentRevisionOptions {
  includeData?: boolean;
  includeText?: boolean;
}

/**
 * Presents a document revision for API responses.
 *
 * @param revision the revision to present.
 * @param options presentation options.
 * @returns the presented revision.
 */
async function presentRevision(
  revision: Revision,
  options: PresentRevisionOptions = {}
) {
  // TODO: Remove this fallback once all revisions have been migrated
  const { emoji, strippedTitle } = parseTitle(revision.title);

  const [data, text, collaborators] = await Promise.all([
    options.includeData === false ? undefined : DocumentHelper.toJSON(revision),
    options.includeText === false
      ? undefined
      : DocumentHelper.toMarkdown(revision),
    revision.collaborators,
  ]);

  return {
    id: revision.id,
    documentId: revision.documentId,
    title: strippedTitle,
    name: revision.name,
    ...(data !== undefined && { data }),
    ...(text !== undefined && { text }),
    icon: revision.icon ?? emoji,
    color: revision.color,
    collaborators: collaborators.map((user) => presentUser(user)),
    createdAt: revision.createdAt,
    createdBy: presentUser(revision.user),
    createdById: revision.userId,
    deletedAt: revision.deletedAt,
  };
}

export default traceFunction({
  spanName: "presenters",
})(presentRevision);
