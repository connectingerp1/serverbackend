const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require('@sendgrid/mail');  

const app = express();

// Set SendGrid API key
sgMail.setApiKey('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');  // Replace with your SendGrid API key

// Middleware to handle CORS
app.use(cors({
  origin: ['https://www.connectingdotserp.com', 'https://qhvpqmhj-3000.inc1.devtunnels.ms'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware to parse JSON request bodies
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect("mongodb+srv://connectingerp1:connecting@connectingcluster.6ifho.mongodb.net/dataconnecting", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log("Connected to MongoDB");
})
.catch((err) => {
  console.log("Error connecting to MongoDB:", err);
});

// Mongoose schema and model
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  contact: String,
  coursename: String,
  createdAt: { type: Date, default: Date.now }  // Automatically set timestamp
});

const User = mongoose.model("User", userSchema);

// API route to handle form submissions
app.post("/api/submit", async (req, res) => {
  const { name, email, contact, coursename } = req.body;

  try {
    const newUser = new User({
      name,
      email,
      contact,
      coursename
    });

    await newUser.save();  // Save to MongoDB
    console.log("User saved to database:", newUser);  // Log success

    // Send email notification using SendGrid
    const msg = {
      to: 'connectingerp1@gmail.com',  // Replace with your email to receive notifications
      from: 'connectingerp1@gmail.com',  // Replace with your verified sender email on SendGrid
      subject: 'New User Submission',
      text: `A new user has registered. 
      Name: ${name}
      Email: ${email}
      Contact: ${contact}
      Course: ${coursename}`,
      html: `<h3>New User Registered</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Contact:</strong> ${contact}</p>
            <p><strong>Course Name:</strong> ${coursename}</p>`
    };

    await sgMail.send(msg);  // Send the email
    console.log("Email sent to notify about the new registration");

    res.status(200).json({ message: "User registered successfully!" });
  } catch (error) {
    console.error("Error saving user or sending email:", error);
    res.status(500).json({ message: "Error saving user data" });
  }
});

// API route to fetch all users (leads)
app.get("/api/leads", async (req, res) => {
  try {
    const users = await User.find();  // Fetch all users from the database
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ message: "Error fetching leads" });
  }
});

// Start the server
app.listen(5001, '0.0.0.0', () => {
  console.log("Server is running on port 5001");
});
