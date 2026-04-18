"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "webhook_subscriptions",
      "includeChanges",
      {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      "webhook_subscriptions",
      "includeChanges"
    );
  },
};
