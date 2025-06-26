"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const body_parser_1 = __importDefault(require("body-parser"));
const x402_express_1 = require("x402-express");
const chatbot_1 = require("./chatbot");
const pinata_1 = require("./pinata");
const memory_1 = require("langchain/vectorstores/memory");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4021;
const facilitatorUrl = process.env.FACILITATOR_URL;
const payTo = process.env.ADDRESS;
const pricePerCall = process.env.SERVICE_PRICE;
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL"); // Allow iframe embedding
    res.setHeader("Access-Control-Allow-Origin", "*"); // Allow external domains
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
});
app.use((0, x402_express_1.paymentMiddleware)(payTo, {
    "POST /chat": {
        price: `$${pricePerCall}`,
        network: "base-sepolia",
    },
}, {
    url: facilitatorUrl,
}));
// POST /chat route
app.post("/chat", async (req, res) => {
    const { prompt, dataUrl } = req.body;
    console.log(prompt, dataUrl);
    if (!dataUrl || !prompt) {
        res.status(400).json({ error: "Both dataUrl and prompt are required!" });
    }
    try {
        const docs = (await (0, pinata_1.fetchVector)(dataUrl));
        if (!Array.isArray(docs)) {
            throw new Error("Expected data to be an array of Document objects");
        }
        // const docs = JSON.parse(data);
        const vectorStore = new memory_1.MemoryVectorStore(chatbot_1.embeddings);
        await vectorStore.addDocuments(docs);
        const graph = await (0, chatbot_1.buildGraph)(vectorStore);
        const result = await graph.invoke({ question: prompt });
        console.log(result.answer);
        res.status(200).json({ reply: result.answer });
    }
    catch (err) {
        console.error("Chat error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ***********************************************************
// GET /test route
app.get("/test", (req, res) => {
    res.status(200).json({ message: "✅ Server is running fine!" });
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Chatbot server running at http://localhost:${PORT}`);
});
