const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
} = require('../controllers/categoriesController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

const READ_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

async function categoriesRoutes(app) {
  app.get(
    '/categories',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listCategories
  );

  app.post(
    '/categories',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createCategory
  );

  app.put(
    '/categories/:categoryId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateCategory
  );

  app.delete(
    '/categories/:categoryId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteCategory
  );

  app.get(
    '/categories/:categoryId/subcategories',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listSubcategories
  );

  app.post(
    '/categories/:categoryId/subcategories',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createSubcategory
  );

  app.put(
    '/subcategories/:subcategoryId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateSubcategory
  );

  app.delete(
    '/subcategories/:subcategoryId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteSubcategory
  );
}

module.exports = categoriesRoutes;
