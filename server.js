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
    'https://connectingdotserp.com', // Main domain
    'https://www.connectingdotserp.com', // Optional www subdomain
    'https://sprightly-crumble-5e7b74.netlify.app', // Your Netlify preview/deploy
    // Add localhost for development IF you run frontend locally
    // 'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) or from allowed list
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`); // Log blocked origins
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], // Include OPTIONS for preflight requests
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// --- Middleware ---
// Body parser middleware MUST come before route handlers that need the parsed body
app.use(bodyParser.json());
// Optional: Handle URL-encoded data if needed
// app.use(bodyParser.urlencoded({ extended: true }));

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
  process.exit(1); // Exit if DB connection fails
});

// --- Mongoose Schema and Model ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'], trim: true },
  email: { type: String, required: [true, 'Email is required'], trim: true, lowercase: true },
  contact: { type: String, required: [true, 'Contact number is required'], trim: true },
  countryCode: { type: String, required: [true, 'Country code is required'] },
  coursename: { type: String, trim: true }, // Optional
  location: { type: String, trim: true }, // Optional
  createdAt: { type: Date, default: Date.now },
});

// Optional: Add indexes for faster lookups (especially on fields you query often)
// userSchema.index({ email: 1 }); // Index for email lookups
// userSchema.index({ contact: 1, countryCode: 1 }); // Compound index if checking contact+code

const User = mongoose.model("User", userSchema);

// --- API Routes ---

// === Form Submission Route ===
app.post("/api/submit", async (req, res) => {
  // Destructure and trim inputs immediately
  const {
    name: nameInput,
    email: emailInput,
    contact: contactInput,
    countryCode: countryCodeInput,
    coursename: coursenameInput,
    location: locationInput
  } = req.body;

  // Trim values or use default if null/undefined
  const name = nameInput?.trim();
  const email = emailInput?.trim().toLowerCase();
  const contact = contactInput?.trim();
  const countryCode = countryCodeInput?.trim();
  const coursename = coursenameInput?.trim() || 'N/A'; // Default if not provided
  const location = locationInput?.trim() || 'N/A'; // Default if not provided

  // --- Backend Validation ---
  // Check for required fields after trimming
  if (!name || !email || !contact || !countryCode) {
    console.log("Validation failed: Missing required fields.");
    // Send 400 status for missing fields
    return res.status(400).json({ message: "Please fill in all required fields (Name, Email, Contact)." });
  }

  // Optional: More specific backend email format validation
  // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // if (!emailRegex.test(email)) {
  //    console.log(`Validation failed: Invalid email format (${email}).`);
  //    return res.status(400).json({ message: "Invalid email format provided." });
  // }
  // Note: Add similar backend validation for contact number format/length if needed

  try {
    // --- Check for existing user by email OR contact number ---
    console.log(`Checking for existing user: email=${email}, contact=${contact}`); // Log check
    const existingUser = await User.findOne({
      $or: [
        { email: email }, // Already lowercased
        { contact: contact }
        // Optional: Check contact + countryCode for more specificity
        // { contact: contact, countryCode: countryCode }
      ]
    }).lean(); // .lean() can make it slightly faster if you only need to check existence

    if (existingUser) {
      // Determine which field caused the conflict
      let conflictMessage = "This record cannot be added because of a duplicate entry."; // Default
      if (existingUser.email === email) {
        conflictMessage = "This email address is already registered. Please use a different email.";
      } else if (existingUser.contact === contact) {
        // Optional: && existingUser.countryCode === countryCode
        conflictMessage = "This contact number is already registered. Please use a different number.";
      }
      console.log(`!!! Duplicate found. Sending 400. Message: "${conflictMessage}"`); // Log before sending
      // Return 400 Bad Request with the specific message
      return res.status(400).json({ message: conflictMessage }); // Ensure JSON format
    }

    // --- If no existing user, proceed to save ---
    console.log("No duplicate found. Proceeding to save new user.");
    const newUser = new User({
        name,
        email,
        contact,
        countryCode,
        coursename,
        location
    });
    await newUser.save(); // This now runs only if no duplicate was found
    console.log("User saved successfully to database:", newUser._id); // Log success

    // --- Send Email Notification (Best effort) ---
    if (process.env.SENDGRID_API_KEY && process.env.NOTIFICATION_EMAIL && process.env.SENDER_EMAIL) {
        try {
            const msg = {
                to: process.env.NOTIFICATION_EMAIL,
                from: {
                    email: process.env.SENDER_EMAIL,
                    name: 'Connecting Dots ERP Notifications' // Optional: Sender Name
                },
                replyTo: email, // Optional: Set reply-to as the user's email
                subject: `New Lead: ${name} (${coursename})`,
                text: `New lead details:\n\nName: ${name}\nEmail: ${email}\nContact: ${countryCode} ${contact}\nCourse: ${coursename}\nLocation: ${location}\nSubmitted: ${new Date().toLocaleString()}`,
                html: `<h3>New Lead Registered</h3>
                       <p><strong>Name:</strong> ${name}</p>
                       <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
                       <p><strong>Contact:</strong> ${countryCode} ${contact}</p>
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
    // Send 200 or 201 (Created) status
    return res.status(201).json({ message: "Registration successful! We will contact you soon." });

  } catch (dbError) {
    // Catch errors from findOne or save operations (e.g., DB connection issues, validation errors *if defined in schema*)
    console.error("!!! Error during database operation in /api/submit:", dbError);
    // Send 500 Internal Server Error for unexpected database issues
    return res.status(500).json({ message: "An internal server error occurred. Please try again later.", error: dbError.message });
  }
});

// === Fetch Leads Route ===
app.get("/api/leads", async (req, res) => {
  try {
    // Fetch users, sort by creation date descending
    const users = await User.find().sort({ createdAt: -1 }).lean(); // Use .lean() for read-only ops
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
      console.log(`Delete failed: Invalid ID format (${id})`);
      return res.status(400).json({ message: "Invalid lead ID format." });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      console.log(`Delete failed: Lead not found with ID (${id})`);
      return res.status(404).json({ message: "Lead not found." });
    }

    console.log("Lead deleted successfully:", id);
    res.status(200).json({ message: "Lead deleted successfully." });
  } catch (error) {
    console.error(`Error deleting lead with ID (${req.params.id}):`, error);
    res.status(500).json({ message: "Internal Server Error occurred while deleting.", error: error.message });
  }
});

// --- Basic Root Route (Optional: for health check) ---
app.get("/", (req, res) => {
  res.status(200).send("Connecting Dots ERP Backend is running.");
});

// --- Global Error Handler (Optional but good practice) ---
// Catches errors not handled by specific routes
app.use((err, req, res, next) => {
  // Handle CORS errors specifically if needed
  if (err.message === 'Not allowed by CORS') {
     console.error(`CORS Error caught by global handler: ${err.message} from origin ${req.header('Origin')}`);
     return res.status(403).json({ message: 'Access denied by CORS policy.' });
  }

  // Log the error stack for debugging
  console.error("!!! Unhandled Error Caught by Global Handler:", err.stack || err);

  // Send a generic 500 response
  // Avoid sending detailed error stack to the client in production
  res.status(500).json({ message: 'An unexpected internal server error occurred.' });
});


// --- Start Server ---
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  // Use 0.0.0.0 to listen on all available network interfaces (important for containers/hosting)
  console.log(`Server is listening intently on port ${PORT}`);
});
