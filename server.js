const express = require("express")
const cors = require("cors")
const { streamToVosk } = require("./sttClient")
const { speakText } = require("./TTSService")
const { initializeApp, cert } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const serviceAccount = require("./serviceAccountKey.json")
const classifyResponse = require("./classifyResponse")
const bcrypt = require("bcryptjs")
const path = require("path")

const app = express()
const PORT = 3000

app.use("/audio", express.static(path.join(__dirname)))
app.use(cors())
app.use(express.json())

// 🔐 Firebase Init
initializeApp({
  credential: cert(serviceAccount),
})
const db = getFirestore()

// Helpers
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash)
}

// 🔄 Create Bot
app.post("/bot", async (req, res) => {
  const { botId, script, voice } = req.body
  if (!botId || !script || !Array.isArray(script)) {
    return res.status(400).json({ error: "botId and script (array) required" })
  }

  try {
    await db.collection("bots").doc(botId).set({
      script,
      sessionProgress: { currentLine: 0 },
      isArchived: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      voice: voice || "en-US-Wavenet-F",
    })
    res.status(200).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: "Failed to save bot", details: err.message })
  }
})

// 🧠 Speak + Listen Loop
app.get("/speak-and-listen/:botId", async (req, res) => {
  const botId = req.params.botId

  try {
    const botRef = db.collection("bots").doc(botId)
    const botDoc = await botRef.get()
    if (!botDoc.exists) return res.status(404).json({ error: "Bot not found" })

    const botData = botDoc.data()
    if (botData.isArchived) return res.status(403).json({ error: "Cannot use archived bot" })

    const currentLine = botData.sessionProgress?.currentLine || 0
    const scriptLine = botData.script[currentLine]
    if (!scriptLine) return res.status(200).json({ done: true, message: "End of script" })

    const voice = botData.voice || "en-US-Wavenet-F"
    await speakText(scriptLine, voice)

    streamToVosk("sample.wav", async (err, text) => {
      if (err) return res.status(500).json({ error: "STT failed", details: err.message })

      const classification = classifyResponse(text)
      let newLine = currentLine
      if (classification === "affirmative") newLine++
      else if (classification === "negative")
        return res.json({ message: "Conversation ended by user", transcript: text })

      await botRef.update({ "sessionProgress.currentLine": newLine })

      res.json({
        transcript: text,
        classification,
        nextLine: botData.script[newLine] || null,
        currentLine: newLine,
      })
    })
  } catch (err) {
    res.status(500).json({ error: "Failed to process", details: err.message })
  }
})

// 🔁 Reset Bot Session
app.post("/reset/:botId", async (req, res) => {
  const botId = req.params.botId
  try {
    const botRef = db.collection("bots").doc(botId)
    const botDoc = await botRef.get()
    if (!botDoc.exists) return res.status(404).json({ error: "Bot not found" })
    if (botDoc.data().isArchived) return res.status(403).json({ error: "Cannot reset archived bot" })

    await botRef.update({ "sessionProgress.currentLine": 0 })
    res.status(200).json({ success: true, message: `Session reset for ${botId}` })
  } catch (err) {
    res.status(500).json({ error: "Failed to reset session", details: err.message })
  }
})

// 📁 Archive / Restore Bot
app.post("/archive/:botId", async (req, res) => {
  const botId = req.params.botId
  try {
    const ref = db.collection("bots").doc(botId)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: "Bot not found" })

    await ref.update({ isArchived: true, archivedAt: new Date().toISOString() })
    res.json({ success: true, message: `Bot ${botId} archived` })
  } catch (err) {
    res.status(500).json({ error: "Failed to archive", details: err.message })
  }
})

app.post("/restore/:botId", async (req, res) => {
  const botId = req.params.botId
  try {
    const ref = db.collection("bots").doc(botId)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: "Bot not found" })

    await ref.update({ isArchived: false, restoredAt: new Date().toISOString() })
    res.json({ success: true, message: `Bot ${botId} restored` })
  } catch (err) {
    res.status(500).json({ error: "Failed to restore", details: err.message })
  }
})

// 👤 Create Agent
app.post("/vcdial-agents", async (req, res) => {
  const { agentId, password } = req.body
  if (!agentId || !password) {
    return res.status(400).json({ error: "agentId and password are required" })
  }

  try {
    const agentsRef = db.collection("vcdial_agents")
    const existing = await agentsRef.where("agentId", "==", agentId).get()
    if (!existing.empty) return res.status(400).json({ error: "Agent already exists" })

    const hashedPassword = await hashPassword(password)
    const newAgent = {
      agentId,
      password: hashedPassword,
      isActive: true,
      createdAt: new Date().toISOString(),
      passwordLastChanged: new Date().toISOString(),
    }

    const docRef = await agentsRef.add(newAgent)
    res.status(201).json({
      success: true,
      message: "Agent created",
      agent: {
        id: docRef.id,
        agentId: newAgent.agentId,
        isActive: newAgent.isActive,
        createdAt: newAgent.createdAt,
      },
    })
  } catch (err) {
    res.status(500).json({ error: "Failed to create agent", details: err.message })
  }
})

// 🧾 Agent Auth
app.post("/vcdial-agents/authenticate", async (req, res) => {
  const { agentId, password } = req.body
  if (!agentId || !password) return res.status(400).json({ error: "Missing credentials" })

  try {
    const snapshot = await db.collection("vcdial_agents").where("agentId", "==", agentId).get()
    if (snapshot.empty) return res.status(401).json({ error: "Invalid credentials" })

    const agent = snapshot.docs[0]
    const agentData = agent.data()
    const isMatch = await comparePassword(password, agentData.password)
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" })

    const { password: _, ...agentInfo } = agentData
    res.json({
      success: true,
      message: "Authentication successful",
      agent: { id: agent.id, ...agentInfo },
    })
  } catch (err) {
    res.status(500).json({ error: "Auth failed", details: err.message })
  }
})

// 🧍‍♂️ Get All Agents
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

// 🔄 Update Agent
app.put("/vcdial-agents/:agentId", async (req, res) => {
  const { password, isActive } = req.body
  const updateData = {}
  if (isActive !== undefined) updateData.isActive = isActive

  try {
    const ref = db.collection("vcdial_agents").doc(req.params.agentId)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: "Agent not found" })

    if (password) {
      updateData.password = await hashPassword(password)
      updateData.passwordLastChanged = new Date().toISOString()
    }

    updateData.updatedAt = new Date().toISOString()
    await ref.update(updateData)

    res.json({ success: true, message: "Agent updated" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ❌ Delete Agent
app.delete("/vcdial-agents/:agentId", async (req, res) => {
  try {
    const ref = db.collection("vcdial_agents").doc(req.params.agentId)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: "Agent not found" })

    await ref.delete()
    res.json({ success: true, message: "Agent deleted" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 🔊 Test Voice
app.post("/test-voice", async (req, res) => {
  const { text, voice } = req.body
  if (!text) return res.status(400).json({ error: "Text is required" })

  try {
    await speakText(text, voice || "en-US-Wavenet-F")
    res.json({ success: true, message: "Voice test completed" })
  } catch (err) {
    res.status(500).json({ error: err.message || "TTS failed" })
  }
})

// ✅ NEW: Get Active Bot Assignments
app.get("/active-bot-assignments", async (req, res) => {
  try {
    const snapshot = await db.collection("bot_assignments")
      .where("isActive", "==", true)
      .get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch active assignments", details: err.message });
  }
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`✅ Voicebot STT+TTS server running at http://localhost:${PORT}`);
});
