require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5600;

app.use(cors());
app.use(express.json());

// ================= ENV =================
const uri = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// GOOGLE CLIENT ID
const GOOGLE_WEB_CLIENT_ID =
  "931013979776-ksm1tngjkn3jut2m7iafdqlafsb5qtkp.apps.googleusercontent.com";

// ================= MONGO CLIENT =================
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ================= IMPACT FUNCTION =================
function calculateImpact(category, value) {
  const num = Number(value);

  switch (category) {
    case "Green Transportation":
      return { co2SavedKg: num * 0.2 };
    case "Water Conservation":
      return { waterSavedL: num };
    case "Tree Plantation":
      return { co2SavedKg: num * 21 };
    case "Energy Saving":
      return { co2SavedKg: num * 0.82 };
    case "Waste Reduction":
      return { co2SavedKg: num * 1.5 };
    default:
      return {};
  }
}

// ================= POINTS FUNCTION =================
function calculatePoints(category, value) {
  const num = Number(value);

  switch (category) {
    case "Green Transportation":
      return num * 2;
    case "Water Conservation":
      return num * 1;
    case "Tree Plantation":
      return num * 50;
    case "Energy Saving":
      return num * 5;
    case "Waste Reduction":
      return num * 10;
    default:
      return num;
  }
}

// ================= BADGES FUNCTION =================
function calculateBadges(totalPoints, totalActivities) {
  let badges = [];

  if (totalActivities >= 1) badges.push("🌱 Beginner");
  if (totalActivities >= 10) badges.push("🔥 Consistent Contributor");
  if (totalActivities >= 25) badges.push("🏆 Eco Champion");
  if (totalActivities >= 50) badges.push("👑 Sustainability Legend");

  if (totalPoints >= 100) badges.push("⭐ 100 Points Club");
  if (totalPoints >= 500) badges.push("💎 500 Points Club");
  if (totalPoints >= 1000) badges.push("🚀 1000 Points Club");

  return badges;
}

// ================= TOKEN MIDDLEWARE =================
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).send({ message: "Token missing" });
    }

    const token = authHeader.split(" ")[1];

    // 1️⃣ Try JWT
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      req.loginType = "jwt";
      return next();
    } catch (err) {}

    // 2️⃣ Google accessToken
    const googleResponse = await axios.get(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const googleUser = googleResponse.data;
    const email = googleUser.email;

    if (!email) {
      return res.status(403).send({ message: "Invalid Google token" });
    }

    const users = client.db("authdb").collection("users");

    let user = await users.findOne({ email });

    // Auto register Google user
    if (!user) {
      const newUser = {
        name: googleUser.name || "Google User",
        email,
        password: null,
        loginType: "google",
        ecoPoints: 0,
        streak: 0,
        lastCheckinDate: null,
        createdAt: new Date(),
      };

      const result = await users.insertOne(newUser);

      user = {
        ...newUser,
        _id: result.insertedId,
      };
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
    };

    req.loginType = "google";

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);
    res.status(403).send({ message: "Unauthorized token" });
  }
}

// ================= MAIN RUN =================
async function run() {
  try {
    await client.connect();

    const users = client.db("authdb").collection("users");
    const activities = client.db("authdb").collection("activities");

    // ================= DAILY CHECK-IN =================
app.post("/checkin", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const user = await users.findOne({ _id: new ObjectId(userId) });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    let checkInCount = user.checkInCount || 0;
    let lastCheckInAt = user.lastCheckInAt
      ? new Date(user.lastCheckInAt)
      : null;

    // First check-in ever
    if (!lastCheckInAt) {
      checkInCount = 1;
      await users.updateOne(
        { _id: user._id },
        {
          $set: {
            checkInCount,
            lastCheckInAt: now,
          },
        }
      );

      return res.send({
        status: "checked-in",
        checkInCount,
        nextCheckInAfter: now.getTime() + 24 * 60 * 60 * 1000,
        redeemed: false,
      });
    }

    const diffHours = (now - lastCheckInAt) / (1000 * 60 * 60);

    // ❌ Less than 24 hours
    if (diffHours < 24) {
      return res.status(400).send({
        status: "too-early",
        message: "You can check in only once every 24 hours",
        nextCheckInAfter:
          lastCheckInAt.getTime() + 24 * 60 * 60 * 1000,
      });
    }

    // 🔁 More than 48 hours → reset
    if (diffHours >= 48) {
      checkInCount = 1;
    } else {
      checkInCount += 1;
    }

    let redeemed = false;
    let ecoBonus = 0;

    // 🎁 Redeem at 10
    if (checkInCount >= 10) {
      ecoBonus = 50;
      redeemed = true;
      checkInCount = 0;

      await users.updateOne(
        { _id: user._id },
        {
          $inc: { ecoPoints: ecoBonus },
        }
      );
    }

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          checkInCount,
          lastCheckInAt: now,
        },
      }
    );

    res.send({
      status: "checked-in",
      checkInCount,
      redeemed,
      ecoBonus,
      nextCheckInAfter: now.getTime() + 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    console.error("CHECK-IN ERROR:", err);
    res.status(500).send({ message: "Check-in failed" });
  }
});


    // ================= REGISTER =================
    app.post("/register", async (req, res) => {
      try {
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
          loginType: "jwt",
          ecoPoints: 0,
          streak: 0,
          lastCheckinDate: null,
          createdAt: new Date(),
        };

        await users.insertOne(user);

        res.send({ message: "User registered successfully" });
      } catch (err) {
        console.error("REGISTER ERROR:", err);
        res.status(500).send({ message: "Registration failed" });
      }
    });

    // ================= LOGIN =================
    app.post("/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        const user = await users.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (!user.password) {
          return res.status(400).send({
            message:
              "This email is registered with Google. Please login with Google.",
          });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).send({ message: "Invalid password" });
        }

        const token = jwt.sign(
          { id: user._id.toString(), email: user.email },
          JWT_SECRET,
          { expiresIn: "7d" }
        );

        res.send({
          message: "Login successful",
          token,
          user: {
            name: user.name,
            email: user.email,
          },
        });
      } catch (err) {
        console.error("LOGIN ERROR:", err);
        res.status(500).send({ message: "Login failed" });
      }
    });

    // ================= GET ME =================
    app.get("/me", verifyToken, async (req, res) => {
      try {
        const user = await users.findOne(
          { _id: new ObjectId(req.user.id) },
          { projection: { password: 0 } }
        );

        const today = new Date().toISOString().split("T")[0];

        res.send({
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            loginType: user.loginType || req.loginType,
          },
          ecoPoints: user.ecoPoints || 0,
          streak: user.streak || 0,
          checkedInToday: user.lastCheckinDate === today,
        });
      } catch (err) {
        console.error("ME ERROR:", err);
        res.status(500).send({ message: "Failed to fetch profile" });
      }
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
        const pointsEarned = calculatePoints(category, value);

        const activity = {
          userId: req.user.id,
          title,
          category,
          description,
          date,
          location,
          value: Number(value),
          impact,
          pointsEarned,
          activityType: activityType || "Personal",
          status: "Completed",
          createdAt: new Date(),
        };

        await activities.insertOne(activity);

        res.send({
          message: "Activity added successfully",
          activity,
        });
      } catch (error) {
        console.error("ADD ACTIVITY ERROR:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ================= MY ACTIVITIES =================
    app.get("/my-activities", verifyToken, async (req, res) => {
      try {
        const list = await activities
          .find({ userId: req.user.id })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(list);
      } catch (err) {
        console.error("MY ACTIVITIES ERROR:", err);
        res.status(500).send({ message: "Failed to fetch activities" });
      }
    });

    // ================= DASHBOARD =================
    app.get("/dashboard", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

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
          totalActivities,
          totalCO2: totalImpact[0]?.co2 || 0,
          totalWater: totalImpact[0]?.water || 0,
        });
      } catch (err) {
        console.error("DASHBOARD ERROR:", err);
        res.status(500).send({ message: "Dashboard fetch failed" });
      }
    });

    // ================= POINTS =================
    app.get("/points", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        const total = await activities
          .aggregate([
            { $match: { userId } },
            {
              $group: {
                _id: null,
                totalPoints: { $sum: "$pointsEarned" },
              },
            },
          ])
          .toArray();

        res.send({
          totalPoints: total[0]?.totalPoints || 0,
        });
      } catch (err) {
        console.error("POINTS ERROR:", err);
        res.status(500).send({ message: "Failed to fetch points" });
      }
    });

    // ================= BADGES =================
    app.get("/badges", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        const totalPointsAgg = await activities
          .aggregate([
            { $match: { userId } },
            {
              $group: {
                _id: null,
                totalPoints: { $sum: "$pointsEarned" },
              },
            },
          ])
          .toArray();

        const totalPoints = totalPointsAgg[0]?.totalPoints || 0;
        const totalActivities = await activities.countDocuments({ userId });

        const badges = calculateBadges(totalPoints, totalActivities);

        res.send({ badges });
      } catch (err) {
        console.error("BADGES ERROR:", err);
        res.status(500).send({ message: "Failed to fetch badges" });
      }
    });

    // ================= LEADERBOARD (WITH BADGES) =================
    app.get("/leaderboard", async (req, res) => {
      try {
        const leaderboard = await activities
          .aggregate([
            {
              $group: {
                _id: "$userId",
                points: { $sum: "$pointsEarned" },
                totalActivities: { $sum: 1 },
              },
            },
            { $sort: { points: -1 } },
            { $limit: 50 },
          ])
          .toArray();

        const userIds = leaderboard.map((x) => new ObjectId(x._id));

        const userList = await users
          .find({ _id: { $in: userIds } }, { projection: { password: 0 } })
          .toArray();

        const userMap = {};
        userList.forEach((u) => {
          userMap[u._id.toString()] = u;
        });

        const finalLeaderboard = leaderboard.map((item, index) => {
          const userBadges = calculateBadges(item.points, item.totalActivities);

          return {
            rank: index + 1,
            userId: item._id,
            name: userMap[item._id]?.name || "Unknown User",
            email: userMap[item._id]?.email || "",
            points: item.points,
            totalActivities: item.totalActivities,
            badges: userBadges,
          };
        });

        res.send(finalLeaderboard);
      } catch (err) {
        console.error("LEADERBOARD ERROR:", err);
        res.status(500).send({ message: "Failed to fetch leaderboard" });
      }
    });

    // ================= LEADERBOARD USER DETAILS (WITH BADGES) =================
    app.get("/leaderboard/:userId", async (req, res) => {
      try {
        const userId = req.params.userId;

        const user = await users.findOne(
          { _id: new ObjectId(userId) },
          { projection: { password: 0 } }
        );

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        const userActivities = await activities
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray();

        const totalPoints = userActivities.reduce(
          (sum, act) => sum + (act.pointsEarned || 0),
          0
        );

        const badges = calculateBadges(totalPoints, userActivities.length);

        res.send({
          user,
          totalActivities: userActivities.length,
          totalPoints,
          badges,
          activities: userActivities,
        });
      } catch (err) {
        console.error("LEADERBOARD USER ERROR:", err);
        res.status(500).send({ message: "Failed to load user details" });
      }
    });

    console.log("✅ Backend connected to MongoDB");
  } catch (err) {
    console.error("MONGO CONNECT ERROR:", err);
  }
}

run();

// ================= START SERVER =================
app.listen(port, () => {
  console.log("🚀 Server running on port", port);
});


