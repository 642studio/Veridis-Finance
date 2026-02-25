const {
  createMember,
  listMembers,
  updateMember,
  deleteMember,
} = require('../controllers/membersController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function membersRoutes(app) {
  app.get(
    '/members',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listMembers
  );

  app.post(
    '/members',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    createMember
  );

  app.patch(
    '/members/:memberId',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateMember
  );

  app.delete(
    '/members/:memberId',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    deleteMember
  );
}

module.exports = membersRoutes;
