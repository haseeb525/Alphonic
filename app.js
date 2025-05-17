// Required Modules
const express = require("express")
const cors = require("cors")
const admin = require("firebase-admin")
const bcrypt = require("bcryptjs")
const mysql = require("mysql2/promise")
const serviceAccount = require("./serviceAccountKey.json")

const app = express()
const PORT = 4000

// Firebase Init
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://voicebotai-39243.firebaseio.com",
})
const db = admin.firestore()

// MySQL Config (VICIdial)
const vicidialDB = mysql.createPool({
  host: "your-vicidial-host", // replace
  user: "your-mysql-user",
  password: "your-mysql-password",
  database: "asterisk",
})

app.use(cors())
app.use(express.json())

// Helper Functions
const hashPassword = async (password) => bcrypt.hash(password, await bcrypt.genSalt(10))
const comparePassword = async (password, hash) => bcrypt.compare(password, hash)

// Create VCdial Agent
app.post("/vcdial-agents", async (req, res) => {
  const { agentId, password, agentLogin, companyName, isNewCompany } = req.body
  if (!agentId || !password || !agentLogin || !companyName)
    return res.status(400).json({ error: "All fields are required" })

  try {
    const existing = await db.collection("vcdial_agents").where("agentId", "==", agentId).get()
    if (!existing.empty)
      return res.status(400).json({ error: "Agent already exists" })

    const hashedPassword = await hashPassword(password)
    const batch = db.batch()

    let companyRef
    if (isNewCompany) {
      const exists = await db.collection("companies").where("name", "==", companyName).get()
      if (!exists.empty)
        return res.status(400).json({ error: "Company already exists" })
      companyRef = db.collection("companies").doc()
      batch.set(companyRef, {
        name: companyName,
        agentLogin,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } else {
      const companySnap = await db.collection("companies").where("name", "==", companyName).get()
      if (companySnap.empty)
        return res.status(400).json({ error: "Company not found" })
      companyRef = companySnap.docs[0].ref
    }

    const agentRef = db.collection("vcdial_agents").doc()
    batch.set(agentRef, {
      agentId,
      password: hashedPassword,
      companyName,
      agentLogin,
      companyRef: companyRef.id,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      passwordLastChanged: admin.firestore.FieldValue.serverTimestamp(),
    })

    await batch.commit()

    // Insert into VICIdial DB
    await vicidialDB.query(
      `INSERT INTO vicidial_users (user, pass, full_name, user_group, active) VALUES (?, ?, ?, ?, 'Y')`,
      [agentId, password, agentLogin, "AGENTS"]
    )

    res.status(201).json({
      success: true,
      message: "Agent created",
      agent: { id: agentRef.id, agentId, companyName, agentLogin, isActive: true },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Server error", details: err.message })
  }
})

// Get all VCdial agents
app.get("/vcdial-agents", async (req, res) => {
  try {
    const snapshot = await db.collection("vcdial_agents").get()
    const agents = snapshot.docs.map((doc) => {
      const data = doc.data()
      const { password, ...agentData } = data
      return { id: doc.id, ...agentData }
    })
    res.json(agents)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Assign bot to agent
app.post("/bot-assignments", async (req, res) => {
  const { agentId, botId } = req.body
  if (!agentId || !botId) return res.status(400).json({ error: "Agent ID and Bot ID are required" })

  try {
    const agentDoc = await db.collection("vcdial_agents").doc(agentId).get()
    if (!agentDoc.exists) return res.status(404).json({ error: "Agent not found" })

    const botDoc = await db.collection("bots").doc(botId).get()
    if (!botDoc.exists || !botDoc.data().isActive || botDoc.data().isArchived) {
      return res.status(400).json({ error: "Bot is not active or has been archived" })
    }

    const existingAssignments = await db.collection("bot_assignments")
      .where("agentId", "==", agentId)
      .where("isActive", "==", true)
      .get()

    const batch = db.batch()

    if (!existingAssignments.empty) {
      existingAssignments.forEach((doc) => {
        batch.update(doc.ref, {
          isActive: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    }

    const assignmentRef = db.collection("bot_assignments").doc()
    batch.set(assignmentRef, {
      agentId,
      botId,
      agentData: {
        id: agentId,
        agentId: agentDoc.data().agentId,
        companyName: agentDoc.data().companyName,
      },
      botData: {
        id: botId,
        name: botDoc.data().name || `Bot ${botId}`,
      },
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await batch.commit()

    res.status(201).json({
      success: true,
      message: "Bot assigned to agent successfully",
      assignment: {
        id: assignmentRef.id,
        agentId,
        botId,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    res.status(500).json({ error: "Failed to assign bot", details: err.message })
  }
})

// Start server
app.listen(PORT, () => console.log(`✅ App server running at http://localhost:${PORT}`))
