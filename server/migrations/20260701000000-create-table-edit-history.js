"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "table_edit_history_batches",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "teams", key: "id" },
            onDelete: "CASCADE",
          },
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "documents", key: "id" },
            onDelete: "CASCADE",
          },
          tableId: { type: Sequelize.STRING, allowNull: false },
          actorId: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
          },
          source: { type: Sequelize.STRING, allowNull: false },
          operationSummary: { type: Sequelize.TEXT, allowNull: false },
          opCount: { type: Sequelize.INTEGER, allowNull: false },
          occurredAt: { type: Sequelize.DATE, allowNull: false },
          endedAt: { type: Sequelize.DATE, allowNull: false },
          metadata: { type: Sequelize.JSONB, allowNull: true },
          createdAt: { type: Sequelize.DATE, allowNull: false },
          updatedAt: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction }
      );

      await queryInterface.createTable(
        "table_edit_history_ops",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          batchId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "table_edit_history_batches", key: "id" },
            onDelete: "CASCADE",
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "teams", key: "id" },
            onDelete: "CASCADE",
          },
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "documents", key: "id" },
            onDelete: "CASCADE",
          },
          tableId: { type: Sequelize.STRING, allowNull: false },
          actorId: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: "users", key: "id" },
            onDelete: "SET NULL",
          },
          source: { type: Sequelize.STRING, allowNull: false },
          operation: { type: Sequelize.TEXT, allowNull: false },
          occurredAt: { type: Sequelize.DATE, allowNull: false },
          rowId: { type: Sequelize.STRING, allowNull: true },
          columnId: { type: Sequelize.STRING, allowNull: true },
          cellId: { type: Sequelize.STRING, allowNull: true },
          rowIndexBefore: { type: Sequelize.INTEGER, allowNull: true },
          rowIndexAfter: { type: Sequelize.INTEGER, allowNull: true },
          columnIndexBefore: { type: Sequelize.INTEGER, allowNull: true },
          columnIndexAfter: { type: Sequelize.INTEGER, allowNull: true },
          oldText: { type: Sequelize.TEXT, allowNull: true },
          newText: { type: Sequelize.TEXT, allowNull: true },
          oldValueHash: { type: Sequelize.STRING, allowNull: true },
          newValueHash: { type: Sequelize.STRING, allowNull: true },
          oldAttrs: { type: Sequelize.JSONB, allowNull: true },
          newAttrs: { type: Sequelize.JSONB, allowNull: true },
          metadata: { type: Sequelize.JSONB, allowNull: true },
          createdAt: { type: Sequelize.DATE, allowNull: false },
          updatedAt: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction }
      );

      await queryInterface.addIndex(
        "table_edit_history_batches",
        ["documentId", "tableId", { name: "endedAt", order: "DESC" }],
        { transaction }
      );
      await queryInterface.addIndex(
        "table_edit_history_ops",
        ["documentId", "tableId", { name: "occurredAt", order: "DESC" }],
        { transaction }
      );
      await queryInterface.addIndex(
        "table_edit_history_ops",
        [
          "documentId",
          "tableId",
          "cellId",
          { name: "occurredAt", order: "DESC" },
        ],
        { transaction }
      );
      await queryInterface.addIndex(
        "table_edit_history_ops",
        ["teamId", "actorId", { name: "occurredAt", order: "DESC" }],
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("table_edit_history_ops", { transaction });
      await queryInterface.dropTable("table_edit_history_batches", {
        transaction,
      });
    });
  },
};
