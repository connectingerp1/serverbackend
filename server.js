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
const allowedOrigins = [
    'https://connectingdotserp.com', // Main domain
    'https://www.connectingdotserp.com', // Optional www subdomain
    'https://sprightly-crumble-5e7b74.netlify.app', // Your Netlify preview/deploy
    'http://localhost:3000' // For local development
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
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// --- Middleware ---
app.use(bodyParser.json());

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log("Connected to MongoDB");
})
.catch((err) => {
  console.error("FATAL: Error connecting to MongoDB:", err);
  process.exit(1);
});

// --- Mongoose Schema and Model ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'], trim: true },
  email: { type: String, required: [true, 'Email is required'], trim: true, lowercase: true },
  contact: { type: String, required: [true, 'Contact number is required'], trim: true },
  // ** MODIFICATION: countryCode is now optional **
  countryCode: { type: String, trim: true }, // Removed required constraint
  coursename: { type: String, trim: true }, // Optional
  location: { type: String, trim: true }, // Optional
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

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
  // ** MODIFICATION: Check only for fundamentally required fields **
  if (!name || !email || !contact) {
    console.log("Validation failed: Missing required fields (Name, Email, Contact).");
    return res.status(400).json({ message: "Please fill in Name, Email, and Contact Number." });
  }

  try {
    // --- Check for existing user by email OR contact number ---
    // (This check remains the same, as it doesn't strictly depend on countryCode unless you need that level of specificity)
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
        // Consider adding countryCode check here if a number should only be unique *within* a country
        // if (existingUser.contact === contact && (!countryCode || existingUser.countryCode === countryCode)) { ... }
        conflictMessage = "This contact number is already registered. Please use a different number.";
      }
      console.log(`!!! Duplicate found. Sending 400. Message: "${conflictMessage}"`);
      return res.status(400).json({ message: conflictMessage });
    }

    // --- If no existing user, proceed to save ---
    console.log("No duplicate found. Proceeding to save new user.");
    // countryCode will be saved as undefined if not provided, which is fine as it's not required in schema
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
            // ** MODIFICATION: Adjust email content for optional countryCode **
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
                       <p><strong>Contact:</strong> ${contactDisplay}</p> {/* Use display variable */}
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
    // If it's a validation error from Mongoose (e.g., required field missing despite frontend check failing)
    if (dbError.name === 'ValidationError') {
        return res.status(400).json({ message: dbError.message });
    }
    // Otherwise, assume internal server error
    return res.status(500).json({ message: "An internal server error occurred. Please try again later.", error: dbError.message });
  }
});

// === Fetch Leads Route ===
app.get("/api/leads", async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ message: "Failed to fetch leads.", error: error.message });
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
    console.log("Lead deleted successfully:", id);
    res.status(200).json({ message: "Lead deleted successfully." });
  } catch (error) {
    console.error(`Error deleting lead with ID (${req.params.id}):`, error);
    res.status(500).json({ message: "Internal Server Error occurred while deleting.", error: error.message });
  }
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
