// Usage: node create-admin.js <username> <password> [role]
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cderp';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

// Use the same schema as in server.js
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed
  email: { type: String, trim: true, lowercase: true },
  role: { type: String, enum: ['SuperAdmin','Admin','ViewMode','EditMode'], default: 'SuperAdmin' },
  active: { type: Boolean, default: true },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
});
const Admin = mongoose.model('Admin', adminSchema);

(async () => {
  const [,, username, password, role = 'SuperAdmin'] = process.argv;
  if (!username || !password) {
    console.log('Usage: node create-admin.js <username> <password> [role]');
    console.log('Role is optional and defaults to SuperAdmin. Valid roles: SuperAdmin, Admin, ViewMode, EditMode');
    process.exit(1);
  }

  // Validate role
  if (!['SuperAdmin', 'Admin', 'ViewMode', 'EditMode'].includes(role)) {
    console.error('Invalid role. Valid roles: SuperAdmin, Admin, ViewMode, EditMode');
    process.exit(1);
  }

  try {
    console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const hash = await bcrypt.hash(password, 12);
    let admin = await Admin.findOne({ username });

    if (admin) {
      admin.password = hash;
      if (role) admin.role = role;
      await admin.save();
      console.log(`Admin "${username}" password updated and role set to "${admin.role}".`);
    } else {
      const newAdmin = await Admin.create({
        username,
        password: hash,
        role,
        active: true,
        createdAt: new Date()
      });
      console.log(`Admin "${username}" created with role "${newAdmin.role}".`);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
