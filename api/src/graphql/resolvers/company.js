const { UserInputError, ForbiddenError } = require('apollo-server-express');
const { validateCompanyName, validateUrl, validatePhone } = require('../../shared/utils/validation');
const logger = require('../../shared/utils/logger');

const companyResolvers = {
  Query: {
    company: async (parent, { id }, { user, prisma, requireAuth }) => {
      const currentUser = requireAuth();

      const company = await prisma.company.findUnique({
        where: { id },
        include: { users: true }
      });

      if (!company) {
        throw new UserInputError('Company not found');
      }

      // Ensure user can only access their own company
      if (currentUser.companyId !== id) {
        throw new ForbiddenError('You can only access your own company');
      }

      return company;
    },

    myCompany: async (parent, args, { user, prisma, requireAuth }) => {
      const currentUser = requireAuth();

      return await prisma.company.findUnique({
        where: { id: currentUser.companyId },
        include: { users: true }
      });
    },
  },

  Mutation: {
    updateCompany: async (parent, { input }, { user, prisma, requireRole }) => {
      const currentUser = requireRole(['OWNER', 'ADMIN']);

      // Validate input
      if (input.name && !validateCompanyName(input.name)) {
        throw new UserInputError('Invalid company name');
      }

      if (input.website && !validateUrl(input.website)) {
        throw new UserInputError('Invalid website URL');
      }

      if (input.phone && !validatePhone(input.phone)) {
        throw new UserInputError('Invalid phone number format');
      }

      // Remove empty strings and null values
      const updateData = {};
      Object.keys(input).forEach(key => {
        if (input[key] !== null && input[key] !== '') {
          updateData[key] = input[key];
        }
      });

      return await prisma.company.update({
        where: { id: currentUser.companyId },
        data: updateData,
        include: { users: true }
      });
    },

    updateSubscription: async (parent, { plan }, { user, prisma, requireRole }) => {
      const currentUser = requireRole(['OWNER']);

      const company = await prisma.company.findUnique({
        where: { id: currentUser.companyId }
      });

      let planExpiresAt = company.planExpiresAt;
      let status = company.status;

      // Calculate new subscription end date based on plan
      if (plan !== 'FREE') {
        const now = new Date();
        const currentEndDate = company.planExpiresAt || now;
        
        // Extend subscription by 30 days from current end date or now, whichever is later
        const extensionStartDate = currentEndDate > now ? currentEndDate : now;
        planExpiresAt = new Date(extensionStartDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        status = 'ACTIVE';
      } else {
        // Free plan doesn't have an end date
        planExpiresAt = null;
        status = 'ACTIVE';
      }

      return await prisma.company.update({
        where: { id: currentUser.companyId },
        data: {
          plan: plan,
          planExpiresAt: planExpiresAt,
          status,
        },
        include: { users: true }
      });
    },
  },

  Subscription: {},

  // Type resolvers
  Company: {
    slug: (parent) => {
      // Generate slug from name if not already set
      if (parent.slug) {
        return parent.slug;
      }
      return parent.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    },

    subscriptionPlan: (parent) => {
      // Map the database 'plan' field to GraphQL 'subscriptionPlan'
      return parent.plan;
    },

    users: async (parent, args, { prisma }) => {
      return await prisma.user.findMany({
        where: { companyId: parent.id },
        orderBy: { createdAt: 'desc' }
      });
    },

    userCount: async (parent, args, { prisma }) => {
      return await prisma.user.count({
        where: { companyId: parent.id }
      });
    },
  },
};

module.exports = { companyResolvers };