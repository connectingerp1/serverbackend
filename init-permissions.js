// Usage: node init-permissions.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cderp';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

// Role Permission Schema
const rolePermissionSchema = new mongoose.Schema({
  role: { type: String, enum: ['SuperAdmin','Admin','ViewMode','EditMode'], required: true, unique: true },
  permissions: {
    users: {
      create: { type: Boolean, default: false },
      read: { type: Boolean, default: false },
      update: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    leads: {
      create: { type: Boolean, default: false },
      read: { type: Boolean, default: false },
      update: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    admins: {
      create: { type: Boolean, default: false },
      read: { type: Boolean, default: false },
      update: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    analytics: {
      view: { type: Boolean, default: false }
    },
    auditLogs: {
      view: { type: Boolean, default: false }
    }
  }
});
const RolePermission = mongoose.model('RolePermission', rolePermissionSchema);

// Initialize default role permissions
const initializeRolePermissions = async () => {
  try {
    console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const count = await RolePermission.countDocuments();
    if (count === 0) {
      console.log("No role permissions found. Creating default permissions...");

      // Default SuperAdmin permissions (all access)
      await RolePermission.create({
        role: 'SuperAdmin',
        permissions: {
          users: { create: true, read: true, update: true, delete: true },
          leads: { create: true, read: true, update: true, delete: true },
          admins: { create: true, read: true, update: true, delete: true },
          analytics: { view: true },
          auditLogs: { view: true }
        }
      });
      console.log("Created SuperAdmin permissions");

      // Default Admin permissions
      await RolePermission.create({
        role: 'Admin',
        permissions: {
          users: { create: true, read: true, update: true, delete: true },
          leads: { create: true, read: true, update: true, delete: true },
          admins: { create: false, read: true, update: false, delete: false },
          analytics: { view: true },
          auditLogs: { view: false }
        }
      });
      console.log("Created Admin permissions");

      // Default ViewMode permissions
      // ViewMode users can only view dashboard data and export CSV
      await RolePermission.create({
        role: 'ViewMode',
        permissions: {
          users: { create: false, read: false, update: false, delete: false },
          leads: { create: false, read: true, update: false, delete: false },
          admins: { create: false, read: false, update: false, delete: false },
          analytics: { view: false },
          auditLogs: { view: false }
        }
      });
      console.log("Created ViewMode permissions");

      // Default EditMode permissions
      // EditMode users can view dashboard, export CSV, and delete leads
      await RolePermission.create({
        role: 'EditMode',
        permissions: {
          users: { create: false, read: false, update: false, delete: false },
          leads: { create: true, read: true, update: true, delete: true },
          admins: { create: false, read: false, update: false, delete: false },
          analytics: { view: false },
          auditLogs: { view: false }
        }
      });
      console.log("Created EditMode permissions");

      console.log('Default role permissions initialized successfully');
    } else {
      console.log(`Role permissions already exist (${count} roles found). No action needed.`);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing role permissions:', error);
    process.exit(1);
  }
};

// Run the initialization
initializeRolePermissions();
