require("dotenv").config();
const express = require("express");
// const dotenv = require("dotenv");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    await client.connect();

    const db = client.db("study-nook");
    const studentsCollection = db.collection("students");

    app.get("/students", async (req, res) => {
const cursor = studentsCollection.find();
const result = await cursor.toArray();
res.send(result);
    });
    
    app.get("/students/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await studentsCollection.findOne(query);
      res.send(result);
    })


    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
};
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Study Nook Server is running");
});

app.listen(port, () => {
  console.log(`Study Nook Server is running on port ${port}`);
});
