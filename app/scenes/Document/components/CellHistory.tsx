import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Empty from "~/components/Empty";
import Flex from "~/components/Flex";
import Time from "~/components/Time";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import SidebarLayout from "./SidebarLayout";

interface TableHistoryOp {
  id: string;
  actor: {
    id: string;
    name: string;
    avatarUrl: string | null;
    color: string;
  } | null;
  oldText: string | null;
  newText: string | null;
  occurredAt: string;
}

function getColumnName(index: number): string {
  let value = index + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function getCellName(
  rowIndex: number | null | undefined,
  columnIndex: number | null | undefined
): string | undefined {
  if (rowIndex === null || rowIndex === undefined) {
    return undefined;
  }
  if (columnIndex === null || columnIndex === undefined) {
    return undefined;
  }

  return `${getColumnName(columnIndex)}${rowIndex + 1}`;
}

function CellHistory() {
  const { t } = useTranslation();
  const { ui } = useStores();
  const [ops, setOps] = React.useState<TableHistoryOp[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const context = ui.cellHistory;
  const documentId = context?.documentId;
  const tableId = context?.tableId;
  const cellId = context?.cellId;
  const cellName = getCellName(context?.rowIndex, context?.columnIndex);

  React.useEffect(() => {
    if (!documentId || !tableId || !cellId) {
      setOps([]);
      return;
    }

    let mounted = true;
    setIsLoading(true);
    setError(null);
    void client
      .post<{ data: { ops: TableHistoryOp[] } }>("/tableHistory.list", {
        documentId,
        tableId,
        cellId,
        limit: 50,
      })
      .then((res) => {
        if (mounted) {
          setOps(res.data.ops);
        }
      })
      .catch(() => {
        if (mounted) {
          setOps([]);
          setError(t("Could not load cell history"));
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [documentId, tableId, cellId, t]);

  const handleClose = React.useCallback(() => {
    ui.set({ rightSidebar: null });
  }, [ui]);

  return (
    <SidebarLayout title={t("Cell history")} onClose={handleClose}>
      {error ? (
        <Empty>{error}</Empty>
      ) : !context || (!isLoading && ops.length === 0) ? (
        <>
          {context ? (
            <Context>
              <strong>
                {t("Document")}
                {": "}
              </strong>
              {context.sourceName}
              <br />
              <strong>
                {t("Cell")}
                {": "}
              </strong>
              {cellName ?? context.cellId}
            </Context>
          ) : null}
          <EmptyState>
            <Empty>{isLoading ? t("Loading") : t("No cell history yet")}</Empty>
          </EmptyState>
        </>
      ) : (
        <List column>
          {context ? (
            <Context>
              <strong>
                {t("Document")}
                {": "}
              </strong>
              {context.sourceName}
              <br />
              <strong>
                {t("Cell")}
                {": "}
              </strong>
              {cellName ?? context.cellId}
            </Context>
          ) : null}
          {ops.map((op) => (
            <Item key={op.id} column gap={4}>
              <Actor align="center" gap={8}>
                {op.actor ? (
                  <Avatar model={op.actor} size={AvatarSize.Small} />
                ) : null}
                <Meta>
                  {op.actor?.name ?? t("Unknown user")}
                  {" · "}
                  <Time dateTime={op.occurredAt} addSuffix />
                </Meta>
              </Actor>
              <Change>
                <Value>{op.oldText || "∅"}</Value>
                <Arrow>→</Arrow>
                <Value>{op.newText || "∅"}</Value>
              </Change>
            </Item>
          ))}
        </List>
      )}
    </SidebarLayout>
  );
}

const List = styled(Flex)`
  padding: 0 16px 16px;
`;

const Item = styled(Flex)`
  border-bottom: 1px solid ${(props) => props.theme.divider};
  padding: 12px 0;
`;

const Context = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
  line-height: 1.5;
  padding: 0 16px 12px;

  strong {
    color: ${(props) => props.theme.text};
  }
`;

const EmptyState = styled.div`
  padding: 0 16px 16px;
`;

const Actor = styled(Flex)`
  min-width: 0;
`;

const Meta = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 12px;
`;

const Change = styled.div`
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
`;

const Arrow = styled.span`
  color: ${(props) => props.theme.textTertiary};
  flex-shrink: 0;
`;

const Value = styled.code`
  background: ${(props) => props.theme.backgroundSecondary};
  border-radius: 4px;
  color: ${(props) => props.theme.text};
  overflow: hidden;
  padding: 2px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export default observer(CellHistory);
