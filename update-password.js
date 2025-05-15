// Usage: node update-password.js <username> <newpassword>
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', adminSchema);

(async () => {
  const [,, username, newPassword] = process.argv;
  if (!username || !newPassword) {
    console.log('Usage: node update-password.js <username> <newpassword>');
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  let admin = await Admin.findOne({ username });
  if (!admin) {
    console.log('Admin not found.');
    process.exit(1);
  }
  admin.password = await bcrypt.hash(newPassword, 12);
  await admin.save();
  console.log('Admin password updated.');
  await mongoose.disconnect();
  process.exit(0);
})();
