"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("excalidraw_drawing_revisions", {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      drawingId: { type: Sequelize.UUID, allowNull: false },
      documentId: { type: Sequelize.UUID, allowNull: false, onDelete: "cascade", references: { model: "documents" } },
      teamId: { type: Sequelize.UUID, allowNull: false, onDelete: "cascade", references: { model: "teams" } },
      createdById: { type: Sequelize.UUID, allowNull: false, references: { model: "users" } },
      scene: { type: Sequelize.JSONB, allowNull: false },
      preview: { type: Sequelize.TEXT, allowNull: true },
      checksum: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("excalidraw_drawing_revisions", ["documentId", "drawingId", "createdAt"]);
    await queryInterface.addIndex("excalidraw_drawing_revisions", ["teamId"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("excalidraw_drawing_revisions");
  },
};
