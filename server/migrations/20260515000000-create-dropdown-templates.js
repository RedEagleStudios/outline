"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "dropdown_templates",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
            },
            onDelete: "cascade",
          },
          createdById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
            },
          },
          updatedById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
            },
          },
          name: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          options: {
            type: Sequelize.JSONB,
            allowNull: false,
          },
          createdAt: {
            allowNull: false,
            type: Sequelize.DATE,
          },
          updatedAt: {
            allowNull: false,
            type: Sequelize.DATE,
          },
          deletedAt: {
            allowNull: true,
            type: Sequelize.DATE,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("dropdown_templates", ["teamId", "name"], {
        name: "dropdown_templates_team_id_name",
        transaction,
      });
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("dropdown_templates");
  },
};
