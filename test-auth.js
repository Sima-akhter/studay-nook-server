const { MongoClient } = require('mongodb');

async function test() {
  try {
    // 1. Log in via Next.js Better Auth
    const res = await fetch('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
    });
    const setCookie = res.headers.get('set-cookie');
    console.log('Set-Cookie:', setCookie);

    let token = null;
    if (setCookie) {
      const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
      if (match) token = match[1];
    }
    console.log('Token from cookie:', token);

    // 2. Search in DB
    const client = new MongoClient('mongodb+srv://studyNook:Rm23YdaXaFcJBbkI@programming-hero.ifoutmp.mongodb.net/?appName=programming-hero');
    await client.connect();
    const db = client.db('study-nook');
    
    // Find latest session
    const latestSession = await db.collection('session').find().sort({createdAt: -1}).limit(1).toArray();
    console.log('Latest Session in DB token:', latestSession[0]?.token);

    if (token === latestSession[0]?.token) {
       console.log("MATCH!");
    } else {
       console.log("NO MATCH!");
    }

    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
test();
