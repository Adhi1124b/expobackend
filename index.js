require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const app = express();
const port = process.env.PORT || 5600;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion,ObjectId } = require("mongodb");

const uri = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

function calculateImpact(category, value) {
  const num = Number(value);

  switch (category) {
    case "Green Transportation":
      return { co2SavedKg: num * 0.2 }; // km × 0.2
    case "Water Conservation":
      return { waterSavedL: num }; // liters
    case "Tree Plantation":
      return { co2SavedKg: num * 21 }; // 1 tree ≈ 21kg/year
    case "Energy Saving":
      return { co2SavedKg: num * 0.82 }; // units × 0.82
    case "Waste Reduction":
      return { co2SavedKg: num * 1.5 }; // kg plastic
    default:
      return {};
  }
}


async function run() {
  try {
    await client.connect();

    const users = client.db("authdb").collection("users");
    const activities = client.db("authdb").collection("activities");

    // ================= REGISTER =================
    app.post("/register", async (req, res) => {
      const { name, email, password } = req.body;

      const existingUser = await users.findOne({ email });
      if (existingUser) {
        return res.status(400).send({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = {
        name,
        email,
        password: hashedPassword,
        createdAt: new Date(),
      };

      await users.insertOne(user);
      res.send({ message: "User registered successfully" });
    });

    // ================= LOGIN =================
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;

      const user = await users.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).send({ message: "Invalid password" });
      }

      const token = jwt.sign(
        { id: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      res.send({
        message: "Login successful",
        token,
        user: {
          name: user.name,
          email: user.email,
        },
      });
    });

    // ================= PROTECTED =================
    app.get("/profile", verifyToken, (req, res) => {
      res.send({
        message: "Protected route accessed",
        user: req.user,
      });
    });

    // ================= ADD ACTIVITY =================
app.post("/activities", verifyToken, async (req, res) => {
  try {
    const {
      title,
      category,
      description,
      date,
      location,
      value,
      activityType,
    } = req.body;

    if (!title || !category || !value) {
      return res.status(400).send({ message: "Required fields missing" });
    }

    const impact = calculateImpact(category, value);

    const activity = {
      userId: req.user.id, // from JWT
      title,
      category,
      description,
      date,
      location,
      value: Number(value),
      impact,
      activityType: activityType || "Personal",
      status: "Pending",
      createdAt: new Date(),
    };

    await activities.insertOne(activity);

    res.send({
      message: "Activity added successfully",
      activity,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

// ================= GET USER ACTIVITIES =================
app.get("/activities", verifyToken, async (req, res) => {
  try {
    const list = await activities
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(list);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch activities" });
  }
});

// ================= DASHBOARD STATS =================
app.get("/dashboard", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayActivities = await activities.countDocuments({
      userId,
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });

    const totalActivities = await activities.countDocuments({ userId });

    const totalImpact = await activities
      .aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            co2: { $sum: "$impact.co2SavedKg" },
            water: { $sum: "$impact.waterSavedL" },
          },
        },
      ])
      .toArray();

    res.send({
      todayActivities,
      totalActivities,
      totalCO2: totalImpact[0]?.co2 || 0,
      totalWater: totalImpact[0]?.water || 0,
    });
  } catch (err) {
    res.status(500).send({ message: "Dashboard fetch failed" });
  }
});

// ================= PROFILE + ACTIVITY HISTORY =================
// ================= PROFILE + ACTIVITY HISTORY =================
app.get("/settings", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    const userActivities = await activities
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({
      user,
      activities: userActivities,
    });
  } catch (error) {
    console.error("SETTINGS ERROR:", error);
    res.status(500).send({ message: "Failed to load settings data" });
  }
});

function calculatePoints(category, value) {
  const rate = POINT_RULES[category] || 0;
  return rate * Number(value);
}

function calculateBadges(activities) {
  const badges = [];

  const water = activities.filter(a => a.category === "Water Conservation").length;
  const tree = activities.filter(a => a.category === "Tree Plantation").length;
  const waste = activities.filter(a => a.category === "Waste Reduction").length;
  const total = activities.length;

  if (water >= 10) badges.push("💧 Water Saver");
  if (tree >= 5) badges.push("🌳 Tree Hero");
  if (waste >= 10) badges.push("♻️ Waste Warrior");
  if (total >= 50) badges.push("🌍 Eco Champion");

  return badges;
}

    console.log("Auth server connected to MongoDB");
  } catch (err) {
    console.error(err);
  }
}

app.get("/points", verifyToken, async (req, res) => {
  try {
    const userActivities = await activities.find({
      userId: req.user.id
    }).toArray();

    const totalPoints = userActivities.reduce((sum, act) => {
      return sum + calculatePoints(act.category, act.value);
    }, 0);

    res.send({ totalPoints });
  } catch (err) {
    res.status(500).send({ message: "Failed to calculate points" });
  }
});

app.get("/badges", verifyToken, async (req, res) => {
  try {
    const userActivities = await activities.find({
      userId: req.user.id
    }).toArray();

    const badges = calculateBadges(userActivities);

    res.send({ badges });
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch badges" });
  }
});

app.get("/leaderboard", async (req, res) => {
  try {
    const allActivities = await activities.find().toArray();
    const usersList = await users.find().toArray();

    const scoreMap = {};

    allActivities.forEach(act => {
      if (!scoreMap[act.userId]) scoreMap[act.userId] = 0;
      scoreMap[act.userId] += calculatePoints(act.category, act.value);
    });

    const leaderboard = Object.entries(scoreMap)
      .map(([userId, points]) => {
        const user = usersList.find(u => u._id.toString() === userId);
        return {
          name: user?.name || "User",
          points
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((item, index) => ({
        rank: index + 1,
        ...item
      }));

    res.send(leaderboard.slice(0, 10));
  } catch (err) {
    res.status(500).send({ message: "Leaderboard fetch failed" });
  }
});



run();

// ================= TOKEN MIDDLEWARE =================
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Token missing" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Invalid token" });
    }
    req.user = decoded;
    next();
  });
}

app.listen(port, () => {
  console.log("Auth server running on port", port);
});
