const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load environment variables

const app = express();

// --- Environment Variable Checks (Good Practice) ---
if (!process.env.SENDGRID_API_KEY) {
  console.warn("WARNING: SENDGRID_API_KEY environment variable not set. Email notifications will fail.");
}
if (!process.env.MONGODB_URI) {
  console.error("ERROR: MONGODB_URI environment variable not set. Cannot connect to database.");
  process.exit(1); // Exit if DB connection string is missing
}

// Set SendGrid API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// --- CORS Configuration ---
const allowedOrigins = [
    'https://connectingdotserp.com', // Main domain
    'https://www.connectingdotserp.com', // Optional www subdomain
    'http://localhost:3000', // For local development
    'http://localhost:3001' // For local development
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// --- Middleware ---
app.use(bodyParser.json());

// --- Mongoose Schema and Model ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'], trim: true },
  email: { type: String, required: [true, 'Email is required'], trim: true, lowercase: true },
  contact: { type: String, required: [true, 'Contact number is required'], trim: true },
  countryCode: { type: String, trim: true }, // Removed required constraint
  coursename: { type: String, trim: true }, // Optional
  location: { type: String, trim: true }, // Optional
  status: { type: String, enum: ['New', 'Contacted', 'Converted', 'Rejected'], default: 'New' },
  contactedScore: { type: Number, min: 1, max: 10 }, // Contacted score from 1-10
  contactedComment: { type: String, trim: true }, // Comment for the contacted score
  notes: { type: String, trim: true, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});
userSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

const User = mongoose.model("User", userSchema);

// --- Settings Schema & Model ---
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String, trim: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
});

settingsSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

const Settings = mongoose.model("Settings", settingsSchema);

// --- Admin Schema & Model ---
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed
  email: { type: String, trim: true, lowercase: true },
  role: { type: String, enum: ['SuperAdmin','Admin','ViewMode','EditMode'], default: 'Admin' },
  active: { type: Boolean, default: true },
  location: { type: String, enum: ['Pune', 'Mumbai', 'Raipur', 'Other'], default: 'Other' },
  color: { type: String, default: '#4299e1' }, // Default color
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
});
const Admin = mongoose.model("Admin", adminSchema);

// --- Audit Log Schema ---
const auditLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  action: String,
  target: String,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// --- Login History Schema ---
const loginHistorySchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  ipAddress: { type: String, default: 'unknown' },
  userAgent: { type: String, default: 'unknown' },
  success: { type: Boolean, required: true },
  loginAt: { type: Date, default: Date.now }
});
const LoginHistory = mongoose.model('LoginHistory', loginHistorySchema);

// --- Activity Log Schema ---
const activityLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  action: { type: String, required: true },
  page: { type: String },
  details: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

// --- Role Permission Schema ---
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

// --- JWT Helper Functions ---
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

function generateToken(admin) {
  return jwt.sign({ id: admin._id, role: admin.role }, JWT_SECRET, { expiresIn: '12h' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

// Helper function to log actions
const logAction = async (adminId, action, target, metadata = {}) => {
  try {
    // If we're logging an action involving a user/lead, fetch their details for better auditing
    if (target === 'User' && metadata.userId) {
      try {
        const user = await User.findById(metadata.userId);
        if (user) {
          metadata.leadName = user.name;
          metadata.leadEmail = user.email;
          metadata.leadContact = user.contact;
        }
      } catch (e) {
        console.error('Error fetching user details for audit log:', e);
      }
    }

    return await AuditLog.create({
      adminId,
      action,
      target,
      metadata
    });
  } catch (err) {
    console.error('Error logging action:', err);
  }
};

// Create a function to track admin activity
async function trackActivity(adminId, action, page = '', details = '') {
  try {
    await ActivityLog.create({ adminId, action, page, details });
  } catch(e) {
    console.error('ActivityLog error', e);
  }
}

// --- Initialize Default Role Permissions if not exists ---
const initializeRolePermissions = async () => {
  try {
    const count = await RolePermission.countDocuments();
    if (count === 0) {
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

      // Default ViewMode permissions
      await RolePermission.create({
        role: 'ViewMode',
        permissions: {
          users: { create: false, read: true, update: false, delete: false },
          leads: { create: false, read: true, update: false, delete: false },
          admins: { create: false, read: false, update: false, delete: false },
          analytics: { view: false },
          auditLogs: { view: false }
        }
      });

      // Default EditMode permissions
      await RolePermission.create({
        role: 'EditMode',
        permissions: {
          users: { create: true, read: true, update: true, delete: false },
          leads: { create: true, read: true, update: true, delete: false },
          admins: { create: false, read: false, update: false, delete: false },
          analytics: { view: false },
          auditLogs: { view: false }
        }
      });

      console.log('Default role permissions initialized');
    }
  } catch (error) {
    console.error('Error initializing role permissions:', error);
  }
};

// === Initialize Default Settings if not exists ===
const initializeDefaultSettings = async () => {
  try {
    const defaultSettings = [
      {
        key: 'restrictLeadEditing',
        value: false,
        description: 'When enabled, only admins or assigned users can edit lead status and contacted fields'
      }
    ];

    for (const setting of defaultSettings) {
      const exists = await Settings.findOne({ key: setting.key });
      if (!exists) {
        await Settings.create(setting);
        console.log(`Default setting created: ${setting.key}`);
      }
    }
  } catch (error) {
    console.error('Error initializing default settings:', error);
  }
};

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log("Connected to MongoDB");
  initializeRolePermissions();
  initializeDefaultSettings();
})
.catch((err) => {
  console.error("FATAL: Error connecting to MongoDB:", err);
  process.exit(1);
});

// --- API Routes ---

// === Form Submission Route ===
app.post("/api/submit", async (req, res) => {
  // Destructure inputs
  const {
    name: nameInput,
    email: emailInput,
    contact: contactInput,
    countryCode: countryCodeInput, // Will be undefined if not sent
    coursename: coursenameInput,
    location: locationInput
  } = req.body;

  // Trim values or use default if null/undefined
  const name = nameInput?.trim();
  const email = emailInput?.trim().toLowerCase();
  const contact = contactInput?.trim();
  // Trim countryCode only if it exists
  const countryCode = countryCodeInput?.trim();
  const coursename = coursenameInput?.trim() || 'N/A';
  const location = locationInput?.trim() || 'N/A';

  // --- Backend Validation ---
  if (!name || !email || !contact) {
    console.log("Validation failed: Missing required fields (Name, Email, Contact).");
    return res.status(400).json({ message: "Please fill in Name, Email, and Contact Number." });
  }

  try {
    // --- Check for existing user by email OR contact number ---
    console.log(`Checking for existing user: email=${email}, contact=${contact}`);
    const existingUser = await User.findOne({
      $or: [
        { email: email },
        { contact: contact }
      ]
    }).lean();

    if (existingUser) {
      let conflictMessage = "This record cannot be added because of a duplicate entry.";
      if (existingUser.email === email) {
        conflictMessage = "This email address is already registered. Please use a different email.";
      } else if (existingUser.contact === contact) {
        conflictMessage = "This contact number is already registered. Please use a different number.";
      }
      console.log(`!!! Duplicate found. Sending 400. Message: "${conflictMessage}"`);
      return res.status(400).json({ message: conflictMessage });
    }

    // --- If no existing user, proceed to save ---
    console.log("No duplicate found. Proceeding to save new user.");
    const newUser = new User({
        name,
        email,
        contact,
        countryCode, // Pass it along (will be undefined if missing)
        coursename,
        location
    });
    await newUser.save();
    console.log("User saved successfully to database:", newUser._id);

    // --- Send Email Notification (Best effort) ---
    if (process.env.SENDGRID_API_KEY && process.env.NOTIFICATION_EMAIL && process.env.SENDER_EMAIL) {
        try {
            const contactDisplay = countryCode ? `${countryCode} ${contact}` : contact; // Display code only if present

            const msg = {
                to: process.env.NOTIFICATION_EMAIL,
                from: {
                    email: process.env.SENDER_EMAIL,
                    name: 'Connecting Dots ERP Notifications'
                },
                replyTo: email,
                subject: `New Lead: ${name} (${coursename})`,
                text: `New lead details:\n\nName: ${name}\nEmail: ${email}\nContact: ${contactDisplay}\nCourse: ${coursename}\nLocation: ${location}\nSubmitted: ${new Date().toLocaleString()}`,
                html: `<h3>New Lead Registered</h3>
                       <p><strong>Name:</strong> ${name}</p>
                       <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
                       <p><strong>Contact:</strong> ${contactDisplay}</p>
                       <p><strong>Course Name:</strong> ${coursename}</p>
                       <p><strong>Location:</strong> ${location}</p>
                       <p><em>Submitted at: ${new Date().toLocaleString()}</em></p>`
            };
            await sgMail.send(msg);
            console.log("Email notification sent successfully.");
        } catch (emailError) {
            console.error("Error sending email notification:", emailError.response ? JSON.stringify(emailError.response.body) : emailError.message);
        }
    } else {
        console.warn("Email notification skipped due to missing SendGrid/Email configuration in .env");
    }

    // --- Success Response to Frontend ---
    return res.status(201).json({ message: "Registration successful! We will contact you soon." });

  } catch (dbError) {
    // Catch errors from findOne or save operations
    console.error("!!! Error during database operation in /api/submit:", dbError);
    if (dbError.name === 'ValidationError') {
        return res.status(400).json({ message: dbError.message });
    }
    return res.status(500).json({ message: "An internal server error occurred. Please try again later.", error: dbError.message });
  }
});

// === Fetch Leads Route (Admin Protected) ===
app.get("/api/leads", authMiddleware, requireRole(['SuperAdmin','Admin','EditMode','ViewMode']), async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).populate('assignedTo', 'username role color').lean();
    await logAction(req.admin.id, 'view_leads', 'User', {});
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ message: "Failed to fetch leads.", error: error.message });
  }
});

// === Update Lead Route (Admin Protected) ===
app.put("/api/leads/:id", authMiddleware, requireRole(['SuperAdmin','Admin','EditMode']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = {};
    const allowedFields = ['name','email','contact','countryCode','coursename','location','status','notes','assignedTo','contactedScore','contactedComment'];
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updateFields[key] = req.body[key];
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead ID format." });
    }

    // Store original lead data for audit log
    const originalLead = await User.findById(id).lean();
    if (!originalLead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true });

    // Prepare detailed metadata for audit log
    const metadataWithChanges = {
      userId: id,
      leadName: originalLead.name,
      leadEmail: originalLead.email,
      leadContact: originalLead.contact,
      updateFields: {},
    };

    // Track specific changes for each field
    for (const key of Object.keys(updateFields)) {
      metadataWithChanges.updateFields[key] = {
        from: originalLead[key],
        to: updateFields[key]
      };
    }

    await logAction(req.admin.id, 'update_lead', 'User', metadataWithChanges);

    res.status(200).json({ message: "Lead updated successfully.", lead: updatedUser });
  } catch (error) {
    console.error(`Error updating lead with ID (${req.params.id}):`, error);
    res.status(500).json({ message: "Internal Server Error occurred while updating.", error: error.message });
  }
});

// === Update Lead Route (PATCH version) (Admin Protected) ===
app.patch("/api/leads/:id", authMiddleware, requireRole(['SuperAdmin','Admin','EditMode','ViewMode']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = {};

    // Define allowed fields based on user role
    let allowedFields = ['contactedScore', 'contactedComment', 'status']; // Base fields that ViewMode can update

    // Expand allowed fields for higher privilege roles
    if (req.admin.role === 'SuperAdmin' || req.admin.role === 'Admin' || req.admin.role === 'EditMode') {
      allowedFields = [...allowedFields, 'name', 'email', 'contact', 'countryCode', 'coursename', 'location', 'notes', 'assignedTo'];
    }

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updateFields[key] = req.body[key];
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead ID format." });
    }

    // Store original lead data for audit log
    const originalLead = await User.findById(id).populate('assignedTo', 'username role').lean();
    if (!originalLead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    // Check if lead editing is restricted to assigned users
    const restrictLeadEditingSetting = await Settings.findOne({ key: 'restrictLeadEditing' }).lean();
    const restrictLeadEditing = restrictLeadEditingSetting ? restrictLeadEditingSetting.value : false;

    // If editing is restricted, check permissions
    if (restrictLeadEditing && req.admin.role !== 'SuperAdmin' && req.admin.role !== 'Admin') {
      // Check if current user is the assigned user for this lead
      const currentAdminId = req.admin.id.toString();
      const assignedToId = originalLead.assignedTo ? originalLead.assignedTo._id.toString() : null;

      // If user is not the assigned user
      if (assignedToId !== currentAdminId) {
        return res.status(403).json({
          message: "You can only edit leads assigned to you when restriction mode is enabled.",
          restricted: true
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true });

    // Prepare detailed metadata for audit log
    const metadataWithChanges = {
      userId: id,
      leadName: originalLead.name,
      leadEmail: originalLead.email,
      leadContact: originalLead.contact,
      updateFields: {},
    };

    // Track specific changes for each field
    for (const key of Object.keys(updateFields)) {
      metadataWithChanges.updateFields[key] = {
        from: originalLead[key],
        to: updateFields[key]
      };
    }

    await logAction(req.admin.id, 'update_lead', 'User', metadataWithChanges);
    res.status(200).json({ message: "Lead updated successfully.", lead: updatedUser });
  } catch (error) {
    console.error(`Error updating lead with ID (${req.params.id}):`, error);
    res.status(500).json({ message: "Failed to update lead", error: error.message });
  }
});

// === Delete Lead Route (Admin Protected) ===
app.delete("/api/leads/:id", authMiddleware, requireRole(['SuperAdmin','Admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead ID format." });
    }

    // Get lead data before deletion for audit log
    const leadToDelete = await User.findById(id).lean();
    if (!leadToDelete) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    // Include detailed information in audit log
    await logAction(req.admin.id, 'delete_lead', 'User', {
      leadId: id,
      userId: id,
      leadName: leadToDelete.name,
      leadEmail: leadToDelete.email,
      leadContact: leadToDelete.contact,
      leadStatus: leadToDelete.status,
      deletedAt: new Date()
    });

    console.log("Lead deleted successfully:", id);
    res.status(200).json({ message: "Lead deleted successfully." });
  } catch (error) {
    console.error(`Error deleting lead with ID (${req.params.id}):`, error);
    res.status(500).json({ message: "Internal Server Error occurred while deleting.", error: error.message });
  }
});

// === Bulk Lead Operations ===
// Bulk update leads
app.put('/api/leads/bulk-update', authMiddleware, requireRole(['SuperAdmin', 'Admin', 'EditMode']), async (req, res) => {
  try {
    const { leadIds, updateData } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: 'No lead IDs provided.' });
    }

    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No update data provided.' });
    }

    // Filter update fields
    const allowedFields = ['status', 'notes', 'assignedTo', 'contactedScore', 'contactedComment'];
    const updateFields = {};
    for (const key of allowedFields) {
      if (updateData[key] !== undefined) updateFields[key] = updateData[key];
    }

    // Get original lead data for audit logs
    const originalLeads = await User.find({ _id: { $in: leadIds } }).lean();

    // Extract basic info for audit logs
    const leadsInfo = originalLeads.map(lead => ({
      id: lead._id,
      name: lead.name,
      email: lead.email,
      contact: lead.contact
    }));

    // Update documents
    const result = await User.updateMany(
      { _id: { $in: leadIds } },
      { $set: updateFields }
    );

    // Enhanced audit logging
    await logAction(req.admin.id, 'bulk_update_leads', 'User', {
      count: result.modifiedCount,
      updateFields,
      affectedLeads: leadsInfo
    });

    res.status(200).json({
      message: `Updated ${result.modifiedCount} leads.`,
      modifiedCount: result.modifiedCount
    });
  } catch (e) {
    res.status(500).json({ message: 'Error updating leads.', error: e.message });
  }
});

// Bulk delete leads
app.delete('/api/leads/bulk-delete', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    const { leadIds } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: 'No lead IDs provided.' });
    }

    // Get lead data before deletion for audit logs
    const leadsToDelete = await User.find({ _id: { $in: leadIds } }).lean();

    // Extract basic info for audit logs
    const leadsInfo = leadsToDelete.map(lead => ({
      id: lead._id,
      name: lead.name,
      email: lead.email,
      contact: lead.contact,
      status: lead.status
    }));

    // Delete documents
    const result = await User.deleteMany({ _id: { $in: leadIds } });

    // Enhanced audit logging
    await logAction(req.admin.id, 'bulk_delete_leads', 'User', {
      count: result.deletedCount,
      leadIds,
      deletedLeads: leadsInfo,
      deletedAt: new Date()
    });

    res.status(200).json({
      message: `Deleted ${result.deletedCount} leads.`,
      deletedCount: result.deletedCount
    });
  } catch (e) {
    res.status(500).json({ message: 'Error deleting leads.', error: e.message });
  }
});

// === Lead Filters ===
app.get('/api/leads/filter', authMiddleware, requireRole(['SuperAdmin', 'Admin', 'EditMode', 'ViewMode']), async (req, res) => {
  try {
    const { status, assignedTo, startDate, endDate, coursename, location, search } = req.query;

    // Build filter
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        filter.assignedTo = null;
      } else if (assignedTo === 'assigned') {
        filter.assignedTo = { $ne: null };
      } else {
        filter.assignedTo = assignedTo;
      }
    }

    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      filter.createdAt = { $gte: new Date(startDate) };
    } else if (endDate) {
      filter.createdAt = { $lte: new Date(endDate) };
    }

    if (coursename) {
      filter.coursename = coursename;
    }

    if (location) {
      filter.location = location;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } }
      ];
    }

    // Get filtered leads
    const leads = await User.find(filter)
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'username role color')
      .lean();

    res.status(200).json(leads);
  } catch (e) {
    res.status(500).json({ message: 'Error filtering leads.', error: e.message });
  }
});

// === Admin Login Route (returns JWT) ===
app.post("/api/admin-login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required.' });
  }

  // Track login attempt for security
  const loginData = {
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || 'unknown',
    success: false
  };

  try {
    // First try to find admin by username
    let admin = await Admin.findOne({ username, active: true });

    // If not found by username, try to find by email if the username looks like an email
    if (!admin && username.includes('@')) {
      admin = await Admin.findOne({ email: username.toLowerCase().trim(), active: true });
    }

    if (!admin) {
      // Save failed login attempt
      await LoginHistory.create({
        ...loginData,
        adminId: null,
        success: false
      });
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      // Save failed login attempt with admin ID
      await LoginHistory.create({
        ...loginData,
        adminId: admin._id,
        success: false
      });
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }

    // Update last login time
    admin.lastLogin = new Date();
    await admin.save();

    // Save successful login
    await LoginHistory.create({
      ...loginData,
      adminId: admin._id,
      success: true
    });

    const token = generateToken(admin);
    await logAction(admin._id, 'login', 'Admin', {});

    return res.status(200).json({
      message: 'Login successful.',
      token,
      role: admin.role,
      username: admin.username,
      id: admin._id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// === Admin CRUD (SuperAdmin only) ===

// Create Admin
app.post('/api/admins', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { username, password, role, email, location, color } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'Username, password, and role are required.' });
    }
    if (!['SuperAdmin','Admin','ViewMode','EditMode'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }
    const existing = await Admin.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: 'Username already exists.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({
      username,
      password: hashed,
      role,
      email,
      location: location || 'Other',
      color: color || '#4299e1',
      createdBy: req.admin.id
    });
    await logAction(req.admin.id, 'create_admin', 'Admin', { adminId: admin._id, username, role });
    res.status(201).json({ message: 'Admin created.', admin: { id: admin._id, username: admin.username, role: admin.role, active: admin.active } });
  } catch (e) {
    res.status(500).json({ message: 'Error creating admin.', error: e.message });
  }
});

// List Admins (SuperAdmin and Admin)
app.get('/api/admins', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    // For non-SuperAdmin users, return limited admin information
    const query = req.admin.role === 'Admin' ?
      { role: { $ne: 'SuperAdmin' } } : // Admin users can't view SuperAdmins
      {};

    const admins = await Admin.find(query).select('username email role active createdAt lastLogin location color').sort({ createdAt: -1 });
    res.status(200).json(admins);
  } catch (err) {
    console.error('Error fetching admins:', err);
    res.status(500).json({ message: 'Failed to fetch admin list.' });
  }
});

// Update Admin (role, active)
app.put('/api/admins/:id', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, active, password, email, location, color } = req.body;
    const updateFields = {};
    if (role) {
      if (!['SuperAdmin','Admin','ViewMode','EditMode'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role.' });
      }
      updateFields.role = role;
    }
    if (typeof active === 'boolean') updateFields.active = active;
    if (password) updateFields.password = await bcrypt.hash(password, 10);
    if (email) updateFields.email = email;
    if (location) updateFields.location = location;
    if (color) updateFields.color = color;
    const admin = await Admin.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true });
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });
    await logAction(req.admin.id, 'update_admin', 'Admin', { adminId: id, updateFields });
    res.status(200).json({
      message: 'Admin updated.',
      admin: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        active: admin.active,
        location: admin.location,
        color: admin.color
      }
    });
  } catch (e) {
    res.status(500).json({ message: 'Error updating admin.', error: e.message });
  }
});

// Delete Admin
app.delete('/api/admins/:id', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.admin.id === id) {
      return res.status(400).json({ message: "You cannot delete yourself." });
    }

    // Get admin data before deletion for complete audit logging
    const adminToDelete = await Admin.findById(id).lean();
    if (!adminToDelete) return res.status(404).json({ message: 'Admin not found.' });

    // Now delete the admin
    const admin = await Admin.findByIdAndDelete(id);

    // Log with detailed information
    await logAction(req.admin.id, 'delete_admin', 'Admin', {
      adminId: id,
      username: adminToDelete.username,
      email: adminToDelete.email,
      role: adminToDelete.role,
      location: adminToDelete.location,
      deletedAt: new Date()
    });

    res.status(200).json({ message: 'Admin deleted.' });
  } catch (e) {
    res.status(500).json({ message: 'Error deleting admin.', error: e.message });
  }
});

// === Role Permissions Management ===
// Get role permissions
app.get('/api/role-permissions', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const permissions = await RolePermission.find().lean();
    res.status(200).json(permissions);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching role permissions.', error: e.message });
  }
});

// Update role permissions
app.put('/api/role-permissions/:role', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { role } = req.params;
    const { permissions } = req.body;

    if (!permissions) {
      return res.status(400).json({ message: 'Permissions are required.' });
    }

    if (!['Admin', 'ViewMode', 'EditMode'].includes(role)) {
      return res.status(400).json({ message: 'Cannot modify SuperAdmin permissions.' });
    }

    const updatedPermission = await RolePermission.findOneAndUpdate(
      { role },
      { permissions },
      { new: true, runValidators: true }
    );

    if (!updatedPermission) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    await logAction(req.admin.id, 'update_role_permissions', 'RolePermission', { role, permissions });
    res.status(200).json({ message: 'Role permissions updated.', permission: updatedPermission });
  } catch (e) {
    res.status(500).json({ message: 'Error updating role permissions.', error: e.message });
  }
});

// === Audit Log (SuperAdmin and Admin, with pagination and filters) ===
app.get('/api/audit-logs', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    // Destructure query parameters with defaults
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      action,
      adminId
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build filter object
    const filter = {};

    // Apply date range filter if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        try {
          filter.createdAt.$gte = new Date(startDate);
        } catch (err) {
          console.error(`Invalid startDate format: ${startDate}`, err);
          // If date is invalid, don't apply this filter
        }
      }

      if (endDate) {
        try {
          const endDatePlusOne = new Date(endDate);
          endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
          filter.createdAt.$lte = endDatePlusOne;
        } catch (err) {
          console.error(`Invalid endDate format: ${endDate}`, err);
          // If date is invalid, don't apply this filter
        }
      }

      // If both date conversions failed, remove the empty filter
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    // Apply action filter if provided
    if (action) filter.action = action;

    // Apply admin filter if provided
    if (adminId) {
      // Safely handle ObjectId conversion
      try {
        filter.adminId = mongoose.Types.ObjectId(adminId);
      } catch (err) {
        console.error(`Invalid adminId format: ${adminId}`, err);
        // Return empty results rather than error
        return res.status(200).json({
          logs: [],
          currentPage: pageNum,
          totalPages: 0,
          totalItems: 0
        });
      }
    }

    // Non-SuperAdmin users can only view logs that don't relate to SuperAdmin actions
    if (req.admin.role === 'Admin') {
      filter.$or = [
        { 'metadata.role': { $ne: 'SuperAdmin' } },
        { 'metadata.role': { $exists: false } }
      ];
    }

    const totalItems = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .populate('adminId', 'username role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      logs,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum),
      totalItems
    });
  } catch (e) {
    console.error('Error fetching audit logs:', e);
    res.status(500).json({ message: 'Error fetching audit logs.', error: e.message });
  }
});

// === User Management CRUD (SuperAdmin/Admin) ===

// List Users (Leads) - already handled by /api/leads

// Get single user
app.get('/api/users/:id', authMiddleware, requireRole(['SuperAdmin','Admin','EditMode','ViewMode']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID." });
    const user = await User.findById(id).populate('assignedTo', 'username role color').lean();
    if (!user) return res.status(404).json({ message: "User not found." });
    res.status(200).json(user);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching user.', error: e.message });
  }
});

// Create user (lead) (Admin only)
app.post('/api/users', authMiddleware, requireRole(['SuperAdmin','Admin','EditMode']), async (req, res) => {
  try {
    const { name, email, contact, countryCode, coursename, location, status, notes, assignedTo, contactedScore, contactedComment } = req.body;
    if (!name || !email || !contact) {
      return res.status(400).json({ message: "Name, email, and contact are required." });
    }
    const existingUser = await User.findOne({ $or: [ { email }, { contact } ] });
    if (existingUser) {
      return res.status(409).json({ message: "User with this email or contact already exists." });
    }
    const user = await User.create({ name, email, contact, countryCode, coursename, location, status, notes, assignedTo, contactedScore, contactedComment });
    await logAction(req.admin.id, 'create_user', 'User', { userId: user._id });
    res.status(201).json({ message: "User created.", user });
  } catch (e) {
    res.status(500).json({ message: 'Error creating user.', error: e.message });
  }
});

// Update user (lead)
app.put('/api/users/:id', authMiddleware, requireRole(['SuperAdmin','Admin','EditMode']), async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = ['name','email','contact','countryCode','coursename','location','status','notes','assignedTo','contactedScore','contactedComment'];
    const updateFields = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updateFields[key] = req.body[key];
    }
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID." });
    const user = await User.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: "User not found." });
    await logAction(req.admin.id, 'update_user', 'User', { userId: id, updateFields });
    res.status(200).json({ message: "User updated.", user });
  } catch (e) {
    res.status(500).json({ message: 'Error updating user.', error: e.message });
  }
});

// Delete user (lead)
app.delete('/api/users/:id', authMiddleware, requireRole(['SuperAdmin','Admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID." });
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: "User not found." });
    await logAction(req.admin.id, 'delete_user', 'User', { userId: id });
    res.status(200).json({ message: "User deleted." });
  } catch (e) {
    res.status(500).json({ message: 'Error deleting user.', error: e.message });
  }
});

// === Get Current Admin Info ===
app.get('/api/current-admin', authMiddleware, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password').lean();
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }
    res.status(200).json(admin);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching admin info.', error: e.message });
  }
});

// === Track Activity ===
app.post('/api/activity', authMiddleware, async (req, res) => {
  try {
    const { action, page, details } = req.body;
    await trackActivity(req.admin.id, action, page, details);
    res.status(200).json({ message: 'Activity logged.' });
  } catch (e) {
    res.status(500).json({ message: 'Error logging activity.', error: e.message });
  }
});

// === Get Admin Activity Logs ===
app.get('/api/admin-activity', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    const { adminId } = req.query;
    const query = adminId ? { adminId } : {};
    const logs = await ActivityLog.find(query)
      .populate('adminId', 'username role')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.status(200).json(logs);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching activity logs.', error: e.message });
  }
});

// === Get Login History (SuperAdmin only, with pagination and filters) ===
app.get('/api/login-history', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { adminId, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Build filter
    const filter = {};

    // Admin filtering with safe ObjectId handling
    if (adminId) {
      try {
        // Only convert to ObjectId if it's a valid format
        if (mongoose.Types.ObjectId.isValid(adminId)) {
          filter.adminId = mongoose.Types.ObjectId(adminId);
        } else {
          console.warn(`Invalid adminId format in login history: ${adminId}`);
          // Return empty results for invalid ID
          return res.status(200).json({
            logs: [],
            totalItems: 0,
            totalPages: 0,
            currentPage: parseInt(page)
          });
        }
      } catch (err) {
        console.error(`Error processing adminId: ${adminId}`, err);
        // Return empty results rather than error
        return res.status(200).json({
          logs: [],
          totalItems: 0,
          totalPages: 0,
          currentPage: parseInt(page)
        });
      }
    }

    // Date filtering with error handling
    if (startDate || endDate) {
      filter.loginAt = {};

      if (startDate) {
        try {
          filter.loginAt.$gte = new Date(startDate);
        } catch (err) {
          console.warn(`Invalid startDate format in login history: ${startDate}`);
          // Don't apply this filter if invalid
        }
      }

      if (endDate) {
        try {
          const endDatePlusOne = new Date(endDate);
          endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
          filter.loginAt.$lte = endDatePlusOne;
        } catch (err) {
          console.warn(`Invalid endDate format in login history: ${endDate}`);
          // Don't apply this filter if invalid
        }
      }

      // If both date conversions failed, remove the empty filter
      if (Object.keys(filter.loginAt).length === 0) {
        delete filter.loginAt;
      }
    }

    // Count total documents for pagination
    const totalItems = await LoginHistory.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / parseInt(limit));

    // Get paginated logs
    const logs = await LoginHistory.find(filter)
      .sort({ loginAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('adminId', 'username role')
      .lean();

    res.status(200).json({
      logs,
      totalItems,
      totalPages,
      currentPage: parseInt(page)
    });
  } catch (e) {
    res.status(500).json({ message: 'Error fetching login history.', error: e.message });
  }
});

// === Admin Analytics ===
app.get('/api/analytics', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    // Count total leads
    const totalLeads = await User.countDocuments();

    // Count leads by status
    const leadsByStatus = await User.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Count leads created in the last 7 days
    const lastWeekLeads = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    // Count leads created in the last 30 days
    const lastMonthLeads = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    // Count leads by course
    const leadsByCourse = await User.aggregate([
      { $group: { _id: '$coursename', count: { $sum: 1 } } }
    ]);

    // Count leads by location
    const leadsByLocation = await User.aggregate([
      { $group: { _id: '$location', count: { $sum: 1 } } }
    ]);

    // Get total admins
    const totalAdmins = await Admin.countDocuments();

    // Get active admins
    const activeAdmins = await Admin.countDocuments({ active: true });

    // Get admin counts by role
    const adminsByRole = await Admin.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Response
    res.status(200).json({
      leads: {
        total: totalLeads,
        byStatus: leadsByStatus,
        lastWeek: lastWeekLeads,
        lastMonth: lastMonthLeads,
        byCourse: leadsByCourse,
        byLocation: leadsByLocation
      },
      admins: {
        total: totalAdmins,
        active: activeAdmins,
        byRole: adminsByRole
      }
    });
  } catch (e) {
    res.status(500).json({ message: 'Error fetching analytics.', error: e.message });
  }
});

// === Settings Management Routes ===
// Get all settings
app.get('/api/settings', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    const settings = await Settings.find().lean();
    res.status(200).json(settings);
  } catch (e) {
    console.error('Error fetching settings:', e);
    res.status(500).json({ message: 'Error fetching settings.', error: e.message });
  }
});

// Get specific setting by key
app.get('/api/settings/:key', authMiddleware, requireRole(['SuperAdmin', 'Admin', 'EditMode', 'ViewMode']), async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await Settings.findOne({ key }).lean();

    if (!setting) {
      return res.status(404).json({ message: 'Setting not found.' });
    }

    res.status(200).json(setting);
  } catch (e) {
    console.error(`Error fetching setting ${req.params.key}:`, e);
    res.status(500).json({ message: 'Error fetching setting.', error: e.message });
  }
});

// Upsert setting (create or update)
app.put('/api/settings/:key', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    if (value === undefined) {
      return res.status(400).json({ message: 'Setting value is required.' });
    }

    const result = await Settings.findOneAndUpdate(
      { key },
      {
        value,
        description,
        updatedBy: req.admin.id,
        updatedAt: new Date()
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logAction(req.admin.id, 'update_setting', 'Settings', {
      key,
      value,
      description
    });

    res.status(200).json({
      message: 'Setting updated successfully.',
      setting: result
    });
  } catch (e) {
    console.error(`Error updating setting ${req.params.key}:`, e);
    res.status(500).json({ message: 'Error updating setting.', error: e.message });
  }
});

// === Wake/Ping Endpoint ===
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: 'Server is awake!' });
});

// --- Basic Root Route ---
app.get("/", (req, res) => {
  res.status(200).send("Connecting Dots ERP Backend is running.");
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
     console.error(`CORS Error caught by global handler: ${err.message} from origin ${req.header('Origin')}`);
     return res.status(403).json({ message: 'Access denied by CORS policy.' });
  }
  console.error("!!! Unhandled Error Caught by Global Handler:", err.stack || err);
  res.status(500).json({ message: 'An unexpected internal server error occurred.' });
});

// --- Start Server ---
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is listening intently on port ${PORT}`);
});
