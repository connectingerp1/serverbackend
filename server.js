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
    const newUser = new User({ name, email, contact, coursename });
    await newUser.save();
    console.log("User saved to database:", newUser);

    // Try sending the email
    try {
      const msg = {
        to: 'connectingerp1@gmail.com',
        from: 'connectingerp1@gmail.com',
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

      await sgMail.send(msg);
      console.log("Email sent to notify about the new registration");
    } catch (emailError) {
      console.error("Error sending email:", emailError.message);
      // Optionally, you can continue with the 200 status if saving is successful
    }

    res.status(200).json({ message: "User registered successfully!" });
  } catch (dbError) {
    console.error("Error saving user:", dbError.message);
    res.status(500).json({ message: "Internal Server Error", error: dbError.message });
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
