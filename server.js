const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load environment variables

const MAX_LOGIN_ATTEMPTS = 3; // Define the maximum login attempts allowed before deactivation

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
    'https://dashboard.connectingdotserp.com',
    'https://www.dashboard.connectingdotserp.com',    
    'https://superadmin.connectingdotserp.com',
    'https://www.superadmin.connectingdotserp.com',
    'https://connecting-dot-erp-97tq.vercel.app',
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
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  // NEW: Fields for login security
  loginAttempts: { type: Number, default: 0 } // Tracks consecutive failed login attempts
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
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false }, // Made optional as admin might not be found
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

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log("Connected to MongoDB");
  initializeRolePermissions();
  // Call the function during startup
  initDefaultSettings();
})
.catch((err) => {
  console.error("FATAL: Error connecting to MongoDB:", err);
  process.exit(1);
});

// Initialize default settings if they don't exist
async function initDefaultSettings() {
  try {
    // Check if required settings exist
    const requiredSettings = [
      {
        key: 'restrictLeadEditing',
        value: false,
        description: 'When enabled, only admins or assigned users can edit lead status and contacted fields'
      },
      {
        key: 'restrictCounselorView',
        value: false,
        description: 'When enabled, counselors can only see leads assigned to them'
      },
      {
        key: 'maxLeadsToDisplay',
        value: 0,
        description: 'Maximum number of leads to display on the dashboard (0 shows all leads)'
      },
      {
        key: 'locationBasedAssignment',
        value: false,
        description: 'When enabled, leads will be automatically assigned to counselors based on their location'
      },
      {
        key: 'locationAssignments',
        value: {},
        description: 'Location to counselor mapping for automatic assignment'
      }
    ];

    for (const setting of requiredSettings) {
      const exists = await Settings.findOne({ key: setting.key });
      if (!exists) {
        await Settings.create(setting);
        console.log(`Created default setting: ${setting.key}`);
      }
    }

    console.log("Default settings initialized");
  } catch (error) {
    console.error("Error initializing default settings:", error);
  }
}

// Auto-assign lead based on location
async function assignLeadByLocation(lead) {
  try {
    // Check if location-based assignment is enabled
    const locationBasedSetting = await Settings.findOne({ key: 'locationBasedAssignment' });
    if (!locationBasedSetting || !locationBasedSetting.value) {
      return null; // Feature not enabled
    }

    // Get location assignments
    const locationAssignmentsSetting = await Settings.findOne({ key: 'locationAssignments' });
    if (!locationAssignmentsSetting || !locationAssignmentsSetting.value) {
      return null; // No assignments configured
    }

    const assignments = locationAssignmentsSetting.value;
    const leadLocation = (lead.location || '').trim();

    if (!leadLocation) {
      return null; // No location to match
    }

    console.log(`Checking location assignment for: ${leadLocation}`);

    // Find matching admin for the lead location
    for (const [adminId, locations] of Object.entries(assignments)) {
      // Case-insensitive match for location
      if (Array.isArray(locations)) {
        // Try exact match first
        const exactMatch = locations.some(loc =>
          leadLocation.toLowerCase() === loc.toLowerCase()
        );

        if (exactMatch) {
          // Found an exact match - verify admin exists and is active
          const admin = await Admin.findOne({ _id: adminId, active: true });
          if (admin) {
            console.log(`Auto-assigned lead to ${admin.username} based on exact location match: ${leadLocation}`);
            return adminId;
          }
        }

        // Try partial match if no exact match found
        const partialMatch = locations.some(loc =>
          leadLocation.toLowerCase().includes(loc.toLowerCase()) ||
          loc.toLowerCase().includes(leadLocation.toLowerCase())
        );

        if (partialMatch) {
          // Found a partial match - verify admin exists and is active
          const admin = await Admin.findOne({ _id: adminId, active: true });
          if (admin) {
            console.log(`Auto-assigned lead to ${admin.username} based on partial location match: ${leadLocation}`);
            return adminId;
          }
        }
      }
    }

    console.log(`No location assignment match found for: ${leadLocation}`);
    return null; // No matching admin found
  } catch (error) {
    console.error("Error in location-based assignment:", error);
    return null;
  }
}

// --- API Routes ---

// --- Contact Form Route (Lead Creation) ---
app.post("/api/contact-form", async (req, res) => {
  try {
    // Validate required fields
    const { name, email, contact, countryCode } = req.body;

    if (!name || !email || !contact) {
      return res.status(400).json({ success: false, message: "Name, email, and contact number are required." });
    }

    // Create new lead
    const newUser = new User({
      ...req.body,
      status: 'New',
      // Handle any potentially undefined fields to prevent schema validation errors
      countryCode: countryCode || '+91' // Default to Indian code if not provided
    });

    // Check for location-based assignment
    const assignedAdminId = await assignLeadByLocation(newUser);
    if (assignedAdminId) {
      newUser.assignedTo = assignedAdminId;
      console.log(`Lead assigned to user ID: ${assignedAdminId}`);
    } else {
      console.log("No automatic location-based assignment applied");
    }

    await newUser.save();

    // Send email notification if enabled
    try {
      const emailEnabled = process.env.EMAIL_NOTIFICATIONS === 'true';
      const sendgridApiKey = process.env.SENDGRID_API_KEY;

      if (emailEnabled && sendgridApiKey) {
        const msg = {
          to: process.env.NOTIFICATION_EMAIL || 'notifications@connectingdotserp.com',
          from: process.env.FROM_EMAIL || 'noreply@connectingdotserp.com',
          subject: 'New Lead Submission',
          text: `New lead submitted: ${name} (${email}, ${contact})`,
          html: `
            <h3>New Lead Details:</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Contact:</strong> ${contact}</p>
            ${newUser.location ? `<p><strong>Location:</strong> ${newUser.location}</p>` : ''}
            ${newUser.coursename ? `<p><strong>Course:</strong> ${newUser.coursename}</p>` : ''}
            ${newUser.assignedTo ? `<p><strong>Auto-assigned:</strong> Yes</p>` : ''}
          `,
        };

        await sgMail.send(msg);
        console.log('Email notification sent');
      }
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
      // Continue execution even if email fails
    }

    console.log("Lead created successfully:", newUser._id);
    res.status(201).json({ success: true, message: "Form submitted successfully!" });
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).json({ success: false, message: "Error submitting form. Please try again later." });
  }
});

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
// Get leads with advanced filtering options and setting-based restrictions
app.get('/api/leads', authMiddleware, requireRole(['SuperAdmin', 'Admin', 'EditMode', 'ViewMode']), async (req, res) => {
  try {
    const { populate } = req.query;
    let filter = {};

    // Get settings that affect lead display
    const maxLeadsToDisplaySetting = await Settings.findOne({ key: 'maxLeadsToDisplay' }).lean();
    const restrictCounselorViewSetting = await Settings.findOne({ key: 'restrictCounselorView' }).lean();

    const maxLeadsToDisplay = maxLeadsToDisplaySetting?.value || 0; // Default to 0 (show all)
    const restrictCounselorView = restrictCounselorViewSetting?.value || false; // Default to false

    // Apply counselor view restriction if enabled (except for SuperAdmin and Admin who can see all)
    if (restrictCounselorView && req.admin.role !== 'SuperAdmin' && req.admin.role !== 'Admin') {
      filter.assignedTo = req.admin.id;
    }

    // Build the query
    let query = User.find(filter).sort({ createdAt: -1 });

    // Apply population if requested
    if (populate === 'assignedTo') {
      query = query.populate('assignedTo', 'username role color');
    }

    // Apply lead display limit if set (maxLeadsToDisplay > 0)
    if (maxLeadsToDisplay > 0) {
      query = query.limit(maxLeadsToDisplay);
    }

    // Execute the query
    const leads = await query.lean();

    // Return the result
    res.status(200).json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ message: 'Error fetching leads', error: error.message });
  }
});

// === Get total lead count ===
app.get('/api/leads/count', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    const count = await User.countDocuments();
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting leads:', error);
    res.status(500).json({ message: 'Error counting leads', error: error.message });
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

    // Handle location filtering - accept multiple location parameters for OR filtering
    if (location) {
      // If we receive a single location
      if (typeof location === 'string') {
        filter.location = { $regex: new RegExp(location, 'i') };
      }
      // If we receive multiple locations, use $or to match any of them
      else if (Array.isArray(location)) {
        filter.$or = filter.$or || [];
        filter.$or.push(...location.map(loc => ({
          location: { $regex: new RegExp(loc, 'i') }
        })));
      }
    }

    if (search) {
      // If we already have $or from locations, we need to merge with search conditions
      const searchConditions = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } }
      ];

      if (filter.$or) {
        // Combined location and search filtering using $and
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions }
        ];
        // Remove the original $or
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
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

  // Prepare data for login history, assuming failure initially
  const loginData = {
    ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || 'unknown',
    success: false // Default to false
  };

  try {
    // Try to find admin by username or email (case-insensitive for email)
    // IMPORTANT: Do NOT filter by `active: true` here, as we need to check inactive accounts too.
    let admin = await Admin.findOne({
      $or: [
        { username: username },
        { email: username.toLowerCase().trim() }
      ]
    });

    // 1. Admin not found at all
    if (!admin) {
      // Log failed attempt without an adminId
      await LoginHistory.create({ ...loginData, adminId: null });
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }

    // Assign admin._id to loginData for logging purposes
    loginData.adminId = admin._id;

    // 2. Account is inactive (deactivated)
    if (!admin.active) {
        await LoginHistory.create(loginData); // Log as failed due to inactive account
        return res.status(401).json({ message: 'Your account is currently inactive. Please contact an administrator.' });
    }

    // 3. Compare password
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      // Password does NOT match
      admin.loginAttempts = (admin.loginAttempts || 0) + 1; // Increment failed attempts

      // Log the failed attempt
      await LoginHistory.create(loginData);

      if (admin.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        admin.active = false; // Deactivate account
        await admin.save();
        // Log the account deactivation in audit logs
        await logAction(admin._id, 'account_deactivated', 'Admin', { reason: 'Too many failed login attempts', attempts: admin.loginAttempts });
        return res.status(401).json({ message: `Invalid password. Your account has been deactivated due to ${MAX_LOGIN_ATTEMPTS} failed login attempts. Please contact an administrator.` });
      } else {
        await admin.save(); // Save the incremented attempts
        return res.status(401).json({ message: `Invalid username/email or password. You have ${MAX_LOGIN_ATTEMPTS - admin.loginAttempts} attempts remaining.` });
      }
    } else {
      // Password MATCHES (Successful Login)
      admin.loginAttempts = 0; // Reset failed attempts on successful login
      admin.lastLogin = new Date();
      await admin.save();

      // Log the successful login
      loginData.success = true; // Mark as success
      await LoginHistory.create(loginData);

      const token = generateToken(admin);
      await logAction(admin._id, 'login', 'Admin', { result: 'success' });

      return res.status(200).json({
        message: 'Login successful.',
        token,
        role: admin.role,
        username: admin.username,
        id: admin._id,
        active: admin.active // Return active status
      });
    }
  } catch (err) {
    console.error("Error during admin login:", err);
    res.status(500).json({ message: 'Server error during login.' });
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
      createdBy: req.admin.id,
      loginAttempts: 0, // Initialize for new admins
      active: true // New admins are active by default
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

    const admins = await Admin.find(query).select('username email role active createdAt lastLogin location color loginAttempts').sort({ createdAt: -1 }); // Added loginAttempts
    res.status(200).json(admins);
  } catch (err) {
    console.error('Error fetching admins:', err);
    res.status(500).json({ message: 'Failed to fetch admin list.' });
  }
});

// Update Admin (role, active, password, email, location, color)
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
    // Only allow setting active status to false/true if it's explicitly provided
    if (typeof active === 'boolean') {
        updateFields.active = active;
        // If an admin is manually reactivated, reset their login attempts
        if (active === true) {
            updateFields.loginAttempts = 0;
        }
    }
    if (password) updateFields.password = await bcrypt.hash(password, 10);
    if (email) updateFields.email = email;
    if (location) updateFields.location = location;
    if (color) updateFields.color = color;

    // Fetch existing admin to log changes and ensure we don't accidentally unset fields
    const existingAdmin = await Admin.findById(id);
    if (!existingAdmin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    const admin = await Admin.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true });
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });

    // Log the changes made
    const metadata = { adminId: id };
    for (const key in updateFields) {
        if (updateFields.hasOwnProperty(key)) {
            metadata[key] = { from: existingAdmin[key], to: updateFields[key] };
        }
    }
    await logAction(req.admin.id, 'update_admin', 'Admin', metadata);
    
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
    console.error('Error updating admin:', e);
    res.status(500).json({ message: 'Error updating admin.', error: e.message });
  }
});


// Reset another admin's password (SuperAdmin only)
app.post('/api/admins/:id/reset-password', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    // Prevent resetting SuperAdmin password
    if (admin.role === 'SuperAdmin') {
      return res.status(403).json({ message: 'Cannot reset password for a SuperAdmin.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    admin.password = hashed;
    admin.loginAttempts = 0;
    await admin.save();

    await logAction(req.admin.id, 'reset_password', 'Admin', {
      targetAdminId: admin._id,
      targetUsername: admin.username,
    });

    res.status(200).json({ message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ message: 'Error resetting password.' });
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
    // Select all fields except password and loginAttempts (security)
    const admin = await Admin.findById(req.admin.id).select('-password -loginAttempts').lean();
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

// --- Get Admin Activity Logs (SuperAdmin and Admin, with pagination and filters) ---
app.get('/api/admin-activity', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    // Destructure query parameters with defaults
    const {
      page = 1, // Default to page 1
      limit = 50, // Default items per page
      startDate,
      endDate,
      action,
      adminId // Filter by the admin whose activity is logged
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build filter object
    const filter = {};

    // Apply filter by admin ID whose activity is logged
    if (adminId) {
       // Safely handle ObjectId conversion
       try {
         filter.adminId = new mongoose.Types.ObjectId(adminId); // Use 'new' with ObjectId
       } catch (err) {
         console.warn(`Invalid adminId format in admin activity filter: ${adminId}`, err);
         // If invalid ID is provided, return empty results rather than error
         return res.status(200).json({
           logs: [],
           currentPage: pageNum,
           totalPages: 0,
           totalItems: 0
         });
       }
    }

    // Apply action filter if provided
    if (action) filter.action = action;

    // Apply date range filter if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        try {
          // Ensure startDate is at the beginning of the day in UTC
          const start = new Date(startDate);
          start.setUTCHours(0, 0, 0, 0);
          filter.createdAt.$gte = start;
        } catch (err) {
          console.warn(`Invalid startDate format in admin activity filter: ${startDate}`, err);
          // If date is invalid, don't apply this specific date filter part
           delete filter.createdAt; // Remove empty createdAt object if both fail
        }
      }

      if (endDate) {
        try {
          // Ensure endDate is at the end of the day in UTC
          const end = new Date(endDate);
          end.setUTCHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        } catch (err) {
          console.warn(`Invalid endDate format in admin activity filter: ${endDate}`, err);
          // If date is invalid, don't apply this specific date filter part
           delete filter.createdAt; // Remove empty createdAt object if both fail
        }
      }

       // If after processing dates, createdAt filter is still an empty object, remove it
       if (filter.createdAt && Object.keys(filter.createdAt).length === 0) {
         delete filter.createdAt;
       }
    }


    // Count total documents matching the filter for pagination metadata
    const totalItems = await ActivityLog.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limitNum);

    // Get paginated and filtered logs
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 }) // Sort by newest first
      .skip(skip)
      .limit(limitNum)
      .populate('adminId', 'username role color') // Populate admin details
      .lean(); // Use lean() for better performance if not modifying docs

    res.status(200).json({
      logs,
      currentPage: pageNum,
      totalPages: totalPages,
      totalItems: totalItems
    });

  } catch (e) {
    console.error('Error fetching admin activity logs:', e);
    res.status(500).json({ message: 'Error fetching admin activity logs.', error: e.message });
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

// === Settings API Routes ===

// Get all settings (SuperAdmin only)
app.get('/api/settings', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const settings = await Settings.find().sort({ key: 1 }).lean();
    res.status(200).json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Error fetching settings', error: error.message });
  }
});

// Get a specific setting by key (SuperAdmin, Admin)
app.get('/api/settings/:key', authMiddleware, requireRole(['SuperAdmin', 'Admin']), async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await Settings.findOne({ key }).lean();

    if (!setting) {
      return res.status(404).json({ message: `Setting "${key}" not found` });
    }

    res.status(200).json(setting);
  } catch (error) {
    console.error(`Error fetching setting "${req.params.key}":`, error);
    res.status(500).json({ message: 'Error fetching setting', error: error.message });
  }
});

// Validate settings before update
function validateSetting(key, value) {
  console.log(`Validating setting: ${key} with value:`, value);

  switch (key) {
    case 'restrictLeadEditing':
    case 'restrictCounselorView':
    case 'locationBasedAssignment':
      // These are boolean settings
      if (typeof value !== 'boolean') {
        console.warn(`Invalid value for ${key}, expected boolean, got ${typeof value}`);
        return false;
      }
      return true;

    case 'maxLeadsToDisplay':
      // This should be a non-negative number
      if (typeof value !== 'number' || value < 0) {
        console.warn(`Invalid value for ${key}, expected non-negative number, got ${typeof value}: ${value}`);
        return false;
      }
      return true;

    case 'locationAssignments':
      // This should be an object with valid IDs as keys and arrays of strings as values
      if (typeof value !== 'object' || value === null) {
        console.warn(`Invalid value for ${key}, expected object, got ${typeof value}`);
        return false;
      }

      try {
        // For empty objects, accept them
        if (Object.keys(value).length === 0) {
          console.log(`Empty location assignments object is valid`);
          return true;
        }

        for (const [adminId, locations] of Object.entries(value)) {
          // Validate admin ID format
          if (!mongoose.Types.ObjectId.isValid(adminId)) {
            console.warn(`Invalid admin ID in locationAssignments: ${adminId}`);
            return false;
          }

          // Validate locations array
          if (!Array.isArray(locations)) {
            console.warn(`Locations for admin ${adminId} is not an array`);
            return false;
          }

          // Validate each location is a non-empty string
          for (const loc of locations) {
            if (typeof loc !== 'string' || loc.trim() === '') {
              console.warn(`Invalid location for admin ${adminId}: ${loc}`);
              return false;
            }
          }
        }
        return true;
      } catch (error) {
        console.error(`Error validating locationAssignments:`, error);
        return false;
      }

    default:
      // For unknown settings, accept any value
      return true;
  }
}

// Create a new setting (SuperAdmin only)
app.post('/api/settings', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { key, value, description } = req.body;

    console.log(`Creating new setting: ${key} with value:`, value);

    // Validate input
    if (!key || value === undefined) {
      return res.status(400).json({ message: 'Setting key and value are required' });
    }

    // Check if setting already exists
    const existingSetting = await Settings.findOne({ key });
    if (existingSetting) {
      return res.status(409).json({ message: `Setting "${key}" already exists` });
    }

    // Validate setting based on its type
    if (!validateSetting(key, value)) {
      return res.status(400).json({ message: 'Invalid value for this setting type' });
    }

    // Create the setting
    const setting = await Settings.create({
      key,
      value,
      description: description || '',
      updatedAt: new Date(),
      updatedBy: req.admin.id
    });

    // Log the action
    await logAction(
      req.admin.id,
      'create',
      'Setting',
      { key, value }
    );

    res.status(201).json(setting);
  } catch (error) {
    console.error(`Error creating setting:`, error);
    res.status(500).json({ message: 'Error creating setting', error: error.message });
  }
});

// Update a setting by key (SuperAdmin only)
app.put('/api/settings/:key', authMiddleware, requireRole(['SuperAdmin']), async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    console.log(`Updating setting: ${key} with value:`, value);

    // Validate input
    if (value === undefined) {
      return res.status(400).json({ message: 'Setting value is required' });
    }

    // Validate setting based on its type
    if (!validateSetting(key, value)) {
      return res.status(400).json({ message: 'Invalid value for this setting type' });
    }

    // Get the existing setting to log changes
    const existingSetting = await Settings.findOne({ key });
    const oldValue = existingSetting ? existingSetting.value : undefined;

    if (!existingSetting) {
      console.log(`Setting ${key} not found, creating it now`);
    }

    // Find and update the setting
    const setting = await Settings.findOneAndUpdate(
      { key },
      {
        value,
        description: description || '',
        updatedAt: new Date(),
        updatedBy: req.admin.id
      },
      { new: true, upsert: true }
    );

    // Log the action
    await logAction(
      req.admin.id,
      existingSetting ? 'update' : 'create',
      'Setting',
      { key, oldValue, newValue: value }
    );

    res.status(200).json(setting);
  } catch (error) {
    console.error(`Error updating setting "${req.params.key}":`, error);
    res.status(500).json({ message: 'Error updating setting', error: error.message });
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
