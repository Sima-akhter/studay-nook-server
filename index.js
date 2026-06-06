const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@programming-hero.ifoutmp.mongodb.net/?appName=programming-hero`;




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
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    finally {
// await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Study Nook Server is running");
})

app.listen(port, () => {
    console.log(`Study Nook Server is running on port ${port}`);
})