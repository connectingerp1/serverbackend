const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require('@sendgrid/mail');
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
// Be specific about allowed origins in production
const allowedOrigins = [
    'https://connectingdotserp.com', // Add trailing slash if needed by requests
    'https://www.connectingdotserp.com', // Consider www subdomain
    'https://sprightly-crumble-5e7b74.netlify.app' // Your Netlify preview/deploy
    // Add 'http://localhost:3000' for local development if needed
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) or from allowed list
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], // Include OPTIONS for preflight
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// --- Middleware ---
// Body parser middleware MUST come before route handlers
app.use(bodyParser.json());
// Optional: Handle URL-encoded data if needed
// app.use(bodyParser.urlencoded({ extended: true }));

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // useCreateIndex: true, // Add this if you plan to use unique indexes later
})
.then(() => {
  console.log("Connected to MongoDB");
})
.catch((err) => {
  console.error("Error connecting to MongoDB:", err);
  process.exit(1); // Exit if DB connection fails
});

// --- Mongoose Schema and Model ---
// Consider adding unique indexes if needed for performance/DB-level constraints,
// but the application-level check provides more control over error messages.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // Add validation
  email: { type: String, required: true, trim: true, lowercase: true }, // Add validation
  contact: { type: String, required: true, trim: true }, // Add validation
  countryCode: { type: String, required: true }, // Assuming you save this now based on frontend
  coursename: String,
  location: String,
  createdAt: { type: Date, default: Date.now },
});

// Example of adding an index (optional, can improve lookup performance)
// userSchema.index({ email: 1 });
// userSchema.index({ contact: 1 });

const User = mongoose.model("User", userSchema);

// --- API Routes ---

// === Form Submission Route ===
app.post("/api/submit", async (req, res) => {
  // Destructure and trim inputs
  const { name, email, contact, countryCode, coursename, location } = req.body;

  // Basic Input Validation (Supplementing Frontend Validation)
  if (!name || !email || !contact || !countryCode) {
    return res.status(400).json({ message: "Missing required fields (name, email, contact, countryCode)." });
  }

  // More specific email format check (optional, regex can be complex)
  // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // if (!emailRegex.test(email)) {
  //    return res.status(400).json({ message: "Invalid email format." });
  // }

  try {
    // *** Check for existing user by email OR contact number ***
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() }, // Case-insensitive email check
        { contact: contact }
        // You might want to check contact + countryCode if numbers can overlap between countries
        // { contact: contact, countryCode: countryCode }
      ]
    });

    if (existingUser) {
      // Determine which field caused the conflict
      let conflictMessage = "This record cannot be added.";
      if (existingUser.email === email.toLowerCase()) {
        conflictMessage = "This email address is already registered.";
      } else if (existingUser.contact === contact) {
        // Add country code check if relevant: && existingUser.countryCode === countryCode
        conflictMessage = "This contact number is already registered.";
      }
      // Return 400 Bad Request for validation failure
      return res.status(400).json({ message: conflictMessage });
    }

    // --- If no existing user, proceed to save ---
    const newUser = new User({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        contact: contact.trim(),
        countryCode: countryCode.trim(), // Save country code
        coursename,
        location
    });
    await newUser.save();
    console.log("User saved to database:", newUser);

    // --- Send Email Notification (Best effort) ---
    if (process.env.SENDGRID_API_KEY && process.env.NOTIFICATION_EMAIL && process.env.SENDER_EMAIL) {
        try {
            const msg = {
                to: process.env.NOTIFICATION_EMAIL,
                from: process.env.SENDER_EMAIL, // Use a verified sender email in SendGrid
                subject: `New Lead Submission: ${coursename || 'General Inquiry'}`,
                text: `A new lead has registered.\n\nName: ${name}\nEmail: ${email}\nContact: ${countryCode} ${contact}\nCourse: ${coursename || 'N/A'}\nLocation: ${location || 'N/A'}`,
                html: `<h3>New Lead Registered</h3>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Contact:</strong> ${countryCode} ${contact}</p>
                    <p><strong>Course Name:</strong> ${coursename || 'N/A'}</p>
                    <p><strong>Location:</strong> ${location || 'N/A'}</p>
                    <p><em>Submitted at: ${new Date().toLocaleString()}</em></p>`
            };
            await sgMail.send(msg);
            console.log("Email notification sent successfully.");
        } catch (emailError) {
            console.error("Error sending email notification:", emailError.response ? emailError.response.body : emailError.message);
            // Do not block the user response because of email failure
        }
    } else {
        console.warn("Email notification skipped due to missing SendGrid configuration.");
    }

    // --- Success Response ---
    res.status(200).json({ message: "Registration successful! We will contact you soon." });

  } catch (dbError) {
    // Catch errors from findOne or save operations
    console.error("Error during form submission processing:", dbError);
    res.status(500).json({ message: "An internal error occurred. Please try again later.", error: dbError.message });
  }
});

// === Fetch Leads Route ===
app.get("/api/leads", async (req, res) => {
  try {
    // Fetch users, sort by creation date descending
    const users = await User.find().sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ message: "Error fetching leads", error: error.message });
  }
});

// === Delete Lead Route ===
app.delete("/api/leads/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lead ID format." });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ message: "Lead not found." });
    }

    console.log("Lead deleted:", id);
    res.status(200).json({ message: "Lead deleted successfully." });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});

// --- Global Error Handler (Optional but Recommended) ---
// app.use((err, req, res, next) => {
//   console.error("Unhandled Error:", err.stack);
//   res.status(500).send('Something broke!');
// });

// --- Start Server ---
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is listening on port ${PORT}`);
});
