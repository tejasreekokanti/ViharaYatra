require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db"); // ✅ Import MongoDB connection
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const http = require("http");

// ✅ Connect to MongoDB
connectDB();

const app = express();
app.use(express.json());
app.use(cors({
  origin: "http://localhost:3000",  // ✅ Match frontend URL
  credentials: true
}));

// ✅ Define User Schema
const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
  },
  { collection: "users" }
);

const User = mongoose.model("User", UserSchema);

// ✅ Define Group Schema
const GroupSchema = new mongoose.Schema(
  {
    name: String,
    members: [String], // User emails
    messages: [{ sender: String, text: String, timestamp: Date }],
  },
  { collection: "groups" }
);
const Group = mongoose.model("Group", GroupSchema);

// ✅ Middleware: Verify JWT Token
const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized. No token provided." });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });

    req.user = decoded;
    next();
  });
};

// ✅ User Registration API
app.post("/api/auth/register", async (req, res) => {
  try {
    let { name, email, password } = req.body;
    email = email.toLowerCase();

    console.log("📩 Registration Request Received:", req.body);

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Email already exists:", email);
      return res.status(400).json({ error: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    console.log("✅ User successfully saved to database:", newUser);
    res.status(201).json({ message: "User registered successfully!" });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ error: "Error registering user" });
  }
});

// ✅ User Login API
app.post("/api/auth/login", async (req, res) => {
  let { email, password } = req.body;
  email = email.toLowerCase();

  try {
    console.log("🔍 Login Request for:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ User not found:", email);
      return res.status(400).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Invalid password for:", email);
      return res.status(400).json({ error: "Invalid password" });
    }

    console.log("✅ Login Successful:", email);
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ✅ API: Get Authenticated User
app.get("/api/auth/user", authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ API: Create Group
app.post("/api/groups", authenticateUser, async (req, res) => {
  const { name } = req.body;
  try {
    const group = new Group({ name, members: [req.user.email], messages: [] });
    await group.save();
    res.status(201).json({ message: "Group created successfully!", group });
  } catch (error) {
    res.status(500).json({ error: "Error creating group" });
  }
});

// ✅ API: Get All Groups
app.get("/api/groups", authenticateUser, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.email });
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: "Error fetching groups" });
  }
});

// ✅ API: Send Message to Group
app.post("/api/groups/:id/message", authenticateUser, async (req, res) => {
  const { text } = req.body;
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const message = { sender: req.user.email, text, timestamp: new Date() };
    group.messages.push(message);
    await group.save();

    io.to(group._id.toString()).emit("newMessage", message);

    res.json({ message: "Message sent!", data: message });
  } catch (error) {
    res.status(500).json({ error: "Error sending message" });
  }
});

// ✅ Setup WebSocket Server
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
    console.log(`👥 User joined group ${groupId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
