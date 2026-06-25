require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

// Middleware
const allowedOrigins = ["https://study-nook-client-omega.vercel.app"];
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.includes(origin) ||
        origin === process.env.CLIENT_URL ||
        (origin.startsWith("https://study-nook-client-omega.vercel.app") &&
          origin.endsWith(".vercel.app"));

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Async wrapper to handle errors
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const db = client.db("study-nook");
const roomsCollection = db.collection("rooms");
const bookingsCollection = db.collection("bookings");
const usersCollection = db.collection("user");
const sessionsCollection = db.collection("session");

client
  .connect()
  .then(() => {
    console.log("Connected to MongoDB!");
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error);
  });

// ----------------------------------------
// MIDDLEWARE
// ----------------------------------------
const authenticate = catchAsync(async (req, res, next) => {
  // Extract session token from cookies or authorization header
  let token =
    req.cookies["better-auth.session_token"] ||
    req.cookies["__secure-better-auth.session_token"];
  
  console.log("Cookies:", req.cookies);
  console.log("Headers Cookie:", req.headers.cookie);
  
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  // 1. Direct DB lookup first (highly efficient, zero network latency)
  if (token) {
    try {
      const session = await sessionsCollection.findOne({ token });
      if (session) {
        // Check for session expiration
        if (!session.expiresAt || new Date(session.expiresAt) >= new Date()) {
          let userQuery = { _id: session.userId };
          if (
            typeof session.userId === "string" &&
            ObjectId.isValid(session.userId)
          ) {
            userQuery = {
              $or: [
                { _id: session.userId },
                { _id: new ObjectId(session.userId) },
              ],
            };
          }

          const user = await usersCollection.findOne(userQuery);
          if (user) {
            req.user = user;
            if (!req.user._id && req.user.id) {
              req.user._id = new ObjectId(req.user.id);
            }
            return next();
          }
        }
      }
    } catch (dbErr) {
      console.error("Direct DB session verification failed:", dbErr.message);
    }
  }

  // 2. Fallback: Try verifying via Next.js Better Auth endpoint (if DB lookup fails or token parsing needs custom hooks)
  try {
    const origin = "https://study-nook-client-omega.vercel.app";

    const headers = {};
    if (req.headers.cookie) headers.cookie = req.headers.cookie;
    if (req.headers.authorization)
      headers.authorization = req.headers.authorization;

    const authRes = await fetch(`${origin}/api/auth/get-session`, {
      headers,
    });

    if (authRes.ok) {
      const sessionData = await authRes.json();
      if (sessionData && sessionData.session) {
        req.user = sessionData.user;
        // Ensure req.user._id exists for existing backend routes
        if (req.user && req.user.id) {
          req.user._id = new ObjectId(req.user.id);
        }
        return next();
      }
    }
  } catch (err) {
    console.error("Auth fetch fallback failed:", err.message);
  }

  return res
    .status(401)
    .json({ success: false, message: "Unauthorized access" });
});

// ----------------------------------------
// ROOM APIs
// ----------------------------------------

// GET /rooms - Search, filter, sort, paginate
app.get(
  "/rooms",
  catchAsync(async (req, res) => {
    const {
      search,
      amenities,
      floor,
      minRate,
      maxRate,
      sort,
      order,
      page = 1,
      limit = 10,
    } = req.query;

    const query = {};
    if (search) {
      query.roomName = { $regex: search, $options: "i" };
    }
    if (amenities) {
      query.amenities = { $in: amenities.split(",") };
    }
    if (floor !== undefined && floor !== "") {
      const parsedFloor = parseInt(floor);
      if (!isNaN(parsedFloor)) {
        query.floor = parsedFloor;
      }
    }
    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
      if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
    }

    const sortOptions = {};
    if (sort) {
      sortOptions[sort] = order === "desc" ? -1 : 1;
    } else {
      sortOptions.createdAt = -1; // Default
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const rooms = await roomsCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const totalRooms = await roomsCollection.countDocuments(query);

    res.json({
      success: true,
      data: rooms,
      pagination: {
        total: totalRooms,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalRooms / parseInt(limit)),
      },
    });
  }),
);

// GET /rooms/latest
app.get(
  "/rooms/latest",
  catchAsync(async (req, res) => {
    const rooms = await roomsCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.json({ success: true, data: rooms });
  }),
);

// GET /rooms/my-listings
app.get(
  "/rooms/my-listings",
  authenticate,
  catchAsync(async (req, res) => {
    const rooms = await roomsCollection
      .find({ owner: req.user._id.toString() })
      .toArray();
    res.json({ success: true, data: rooms });
  }),
);

// GET /rooms/availability
app.get(
  "/rooms/availability",
  catchAsync(async (req, res) => {
    const { roomId, date } = req.query;
    if (!roomId || !date)
      return res
        .status(400)
        .json({ success: false, message: "roomId and date required" });

    const bookings = await bookingsCollection
      .find({ roomId, date, status: "confirmed" })
      .toArray();
    const allSlots = [];
    for (let i = 8; i < 20; i++) {
      const start = `${i.toString().padStart(2, "0")}:00`;
      const end = `${(i + 1).toString().padStart(2, "0")}:00`;
      allSlots.push({ startTime: start, endTime: end });
    }

    const availableSlots = allSlots.map((slot) => {
      const slotStart = parseInt(slot.startTime.split(":")[0]);
      const slotEnd = parseInt(slot.endTime.split(":")[0]);

      const isUnavailable = bookings.some((b) => {
        const bStart = parseInt(b.startTime.split(":")[0]);
        const bEnd = parseInt(b.endTime.split(":")[0]);
        return slotStart < bEnd && slotEnd > bStart;
      });

      return { ...slot, available: !isUnavailable };
    });

    res.json({ success: true, data: availableSlots });
  }),
);

// GET /rooms/:id
app.get(
  "/rooms/:id",
  catchAsync(async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    res.json({ success: true, data: room });
  }),
);

// POST /rooms
app.post(
  "/rooms",
  authenticate,
  catchAsync(async (req, res) => {
    const room = req.body;

    if (
      !room.roomName ||
      !room.description ||
      !room.imageUrl ||
      room.floor === undefined ||
      room.floor === null ||
      room.capacity === undefined ||
      room.capacity === null ||
      room.hourlyRate === undefined ||
      room.hourlyRate === null
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    room.owner = req.user._id.toString();
    room.bookingCount = 0;
    room.createdAt = new Date();
    room.floor = parseInt(room.floor);
    room.capacity = parseInt(room.capacity);
    room.hourlyRate = parseFloat(room.hourlyRate);

    if (isNaN(room.floor) || isNaN(room.capacity) || isNaN(room.hourlyRate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid numeric fields provided",
      });
    }

    const result = await roomsCollection.insertOne(room);
    res.json({
      success: true,
      message: "Room created successfully",
      data: result,
    });
  }),
);

// PATCH /rooms/:id
app.patch(
  "/rooms/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.owner !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only owner can update" });
    }

    const updates = { ...req.body };
    delete updates._id;

    if (updates.floor !== undefined && updates.floor !== null) {
      updates.floor = parseInt(updates.floor);
      if (isNaN(updates.floor))
        return res
          .status(400)
          .json({ success: false, message: "Invalid numeric floor" });
    }
    if (updates.capacity !== undefined && updates.capacity !== null) {
      updates.capacity = parseInt(updates.capacity);
      if (isNaN(updates.capacity))
        return res
          .status(400)
          .json({ success: false, message: "Invalid numeric capacity" });
    }
    if (updates.hourlyRate !== undefined && updates.hourlyRate !== null) {
      updates.hourlyRate = parseFloat(updates.hourlyRate);
      if (isNaN(updates.hourlyRate))
        return res
          .status(400)
          .json({ success: false, message: "Invalid numeric hourlyRate" });
    }

    const result = await roomsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates },
    );

    res.json({
      success: true,
      message: "Room updated successfully",
      data: result,
    });
  }),
);

// DELETE /rooms/:id
app.delete(
  "/rooms/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.owner !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only owner can delete" });
    }

    const result = await roomsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    await bookingsCollection.deleteMany({ roomId: id });

    res.json({
      success: true,
      message: "Room deleted successfully",
      data: result,
    });
  }),
);

// ----------------------------------------
// BOOKING APIs
// ----------------------------------------

// POST /bookings
app.post(
  "/bookings",
  authenticate,
  catchAsync(async (req, res) => {
    const { roomId, date, startTime, endTime } = req.body;

    if (!roomId || !date || !startTime || !endTime) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      return res.status(400).json({
        success: false,
        message: "Date must be today or in the future",
      });
    }

    const startHour = parseInt(startTime.split(":")[0]);
    const endHour = parseInt(endTime.split(":")[0]);

    if (endHour <= startHour) {
      return res.status(400).json({
        success: false,
        message: "End time must be greater than start time",
      });
    }

    if (endHour - startHour < 1) {
      return res.status(400).json({
        success: false,
        message: "Minimum booking duration is 1 hour",
      });
    }

    const room = await roomsCollection.findOne({
      _id: new ObjectId(roomId),
    });
    if (!room) {
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });
    }

    const overlap = await bookingsCollection.findOne({
      roomId,
      date,
      status: { $ne: "cancelled" },
      $or: [{ startTime: { $lt: endTime }, endTime: { $gt: startTime } }],
    });

    if (overlap) {
      return res
        .status(409)
        .json({ success: false, message: "Booking conflict detected" });
    }

    const totalCost = (endHour - startHour) * room.hourlyRate;

    const booking = {
      roomId,
      userId: req.user._id.toString(),
      date,
      startTime,
      endTime,
      totalCost,
      status: "confirmed",
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(booking);

    await roomsCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } },
    );

    await usersCollection.updateOne(
      { _id: new ObjectId(req.user._id) },
      { $push: { bookings: result.insertedId.toString() } },
    );

    res.json({
      success: true,
      message: "Booking created successfully",
      data: result,
    });
  }),
);

// GET /bookings/my-bookings
app.get(
  "/bookings/my-bookings",
  authenticate,
  catchAsync(async (req, res) => {
    const bookings = await bookingsCollection
      .aggregate([
        { $match: { userId: req.user._id.toString() } },
        { $addFields: { roomIdObj: { $toObjectId: "$roomId" } } },
        {
          $lookup: {
            from: "rooms",
            localField: "roomIdObj",
            foreignField: "_id",
            as: "room",
          },
        },
        { $unwind: "$room" },
        { $project: { roomIdObj: 0 } },
      ])
      .toArray();

    res.json({ success: true, data: bookings });
  }),
);

// PATCH /bookings/:id/cancel
app.patch(
  "/bookings/:id/cancel",
  authenticate,
  catchAsync(async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    if (booking.userId !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only booking owner can cancel" });
    }

    if (booking.status === "cancelled") {
      return res
        .status(400)
        .json({ success: false, message: "Booking is already cancelled" });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled" } },
    );

    await roomsCollection.updateOne(
      { _id: new ObjectId(booking.roomId) },
      { $inc: { bookingCount: -1 } },
    );

    await usersCollection.updateOne(
      { _id: new ObjectId(req.user._id) },
      { $pull: { bookings: id } },
    );

    res.json({ success: true, message: "Booking cancelled successfully" });
  }),
);

// GET /bookings/room/:roomId
app.get(
  "/bookings/room/:roomId",
  catchAsync(async (req, res) => {
    const roomId = req.params.roomId;
    const bookings = await bookingsCollection
      .find({ roomId, status: { $ne: "cancelled" } })
      .toArray();
    res.json({ success: true, data: bookings });
  }),
);

// GET /bookings/:id
app.get(
  "/bookings/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid ID" });

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    res.json({ success: true, data: booking });
  }),
);

// ----------------------------------------
// DASHBOARD & EXTRA APIs
// ----------------------------------------

// GET /dashboard/summary
app.get(
  "/dashboard/summary",
  authenticate,
  catchAsync(async (req, res) => {
    const userId = req.user._id.toString();

    const totalRoomsOwned = await roomsCollection.countDocuments({
      owner: userId,
    });
    const totalBookingsMade = await bookingsCollection.countDocuments({
      userId,
    });
    const totalConfirmedBookings = await bookingsCollection.countDocuments({
      userId,
      status: "confirmed",
    });
    const totalCancelledBookings = await bookingsCollection.countDocuments({
      userId,
      status: "cancelled",
    });

    res.json({
      success: true,
      data: {
        totalRoomsOwned,
        totalBookingsMade,
        totalConfirmedBookings,
        totalCancelledBookings,
      },
    });
  }),
);

// GET /dashboard/recent-bookings
app.get(
  "/dashboard/recent-bookings",
  authenticate,
  catchAsync(async (req, res) => {
    const bookings = await bookingsCollection
      .aggregate([
        { $match: { userId: req.user._id.toString() } },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        { $addFields: { roomIdObj: { $toObjectId: "$roomId" } } },
        {
          $lookup: {
            from: "rooms",
            localField: "roomIdObj",
            foreignField: "_id",
            as: "room",
          },
        },
        { $unwind: "$room" },
        { $project: { roomIdObj: 0 } },
      ])
      .toArray();

    res.json({ success: true, data: bookings });
  }),
);

// GET /search
app.get(
  "/search",
  catchAsync(async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ success: true, data: [] });

    const rooms = await roomsCollection
      .find({
        $or: [
          { roomName: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
        ],
      })
      .limit(10)
      .toArray();

    res.json({ success: true, data: rooms });
  }),
);

// GET /stats
app.get(
  "/stats",
  catchAsync(async (req, res) => {
    const totalUsers = await usersCollection.countDocuments();
    const totalRooms = await roomsCollection.countDocuments();
    const totalBookings = await bookingsCollection.countDocuments();
    const activeBookings = await bookingsCollection.countDocuments({
      status: "confirmed",
    });

    res.json({
      success: true,
      data: { totalUsers, totalRooms, totalBookings, activeBookings },
    });
  }),
);

// ----------------------------------------
// ERROR HANDLER
// ----------------------------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

app.get("/", (req, res) => {
  res.send("Study Nook Server is running");
});

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Study Nook Server is running on port ${port}`);
  });
}

module.exports = app;
