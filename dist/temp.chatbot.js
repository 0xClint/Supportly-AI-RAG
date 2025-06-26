"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prePrompt = void 0;
exports.initGraph = initGraph;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const messages_1 = require("@langchain/core/messages");
const zod_1 = require("zod");
const google_genai_1 = require("@langchain/google-genai");
const aws_1 = require("@langchain/aws");
const memory_1 = require("langchain/vectorstores/memory");
const puppeteer_1 = require("@langchain/community/document_loaders/web/puppeteer");
const textsplitters_1 = require("@langchain/textsplitters");
const tools_1 = require("@langchain/core/tools");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const langgraph_1 = require("@langchain/langgraph");
const prebuilt_2 = require("@langchain/langgraph/prebuilt");
// LLM
const llm = new google_genai_1.ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0,
});
// Embeddings model
const embeddings = new aws_1.BedrockEmbeddings({
    model: "amazon.titan-embed-text-v1",
    region: process.env.BEDROCK_AWS_REGION || "",
    credentials: {
        accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY || "",
    },
});
// Load and split documents
async function loadAndSplitDocs() {
    const loader = new puppeteer_1.PuppeteerWebBaseLoader("https://omkar-ten.vercel.app/", {
        launchOptions: {
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
        gotoOptions: {
            waitUntil: "networkidle2",
            timeout: 30000,
        },
        evaluate: async (page) => {
            await page.waitForSelector("body", { timeout: 10000 });
            const content = await page.evaluate(() => {
                const main = document.querySelector("main");
                if (main && main.innerText.trim())
                    return main.innerText;
                const body = document.querySelector("body");
                return body ? body.innerText : "";
            });
            return content || "No content extracted.";
        },
    });
    const rawDocs = await loader.load();
    const splitter = new textsplitters_1.RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const splitDocs = await splitter.splitDocuments(rawDocs);
    return splitDocs;
}
// Tool for retrieving context from vector store
function getRetrieveTool(vectorStore) {
    return (0, tools_1.tool)(async ({ query }) => {
        const retrievedDocs = await vectorStore.similaritySearch(query, 4);
        const serialized = retrievedDocs
            .map((doc) => `Source: ${doc.metadata?.source || "web"}\nContent: ${doc.pageContent}`)
            .join("\n");
        return [serialized, retrievedDocs];
    }, {
        name: "retrieve",
        description: "Retrieve information related to a query.",
        schema: zod_1.z.object({ query: zod_1.z.string() }),
        responseFormat: "content_and_artifact",
    });
}
// Step 1: Generate query or direct response
function queryOrRespondNode(retrieveTool) {
    return async (state) => {
        const llmWithTools = llm.bindTools([retrieveTool]);
        const response = await llmWithTools.invoke(state.messages);
        return { messages: [response] };
    };
}
// Step 2: Generate final answer
async function generate(state) {
    const toolMessages = state.messages.filter((m) => m instanceof messages_1.ToolMessage);
    const docsText = toolMessages.map((msg) => msg.content).join("\n");
    const systemMessage = new messages_1.SystemMessage(`You are a helpful and friendly AI support assistant. 
Answer user questions accurately and concisely using the provided support materials. 
If information is missing or unclear, politely inform the user and suggest they provide more details. Be concise and informative.\n\n${docsText}`);
    const convo = state.messages.filter((msg) => msg instanceof messages_1.HumanMessage ||
        (msg instanceof messages_1.AIMessage && (msg.tool_calls?.length ?? 0) === 0));
    const prompt = [systemMessage, ...convo];
    const response = await llm.invoke(prompt);
    return { messages: [response] };
}
// Build LangGraph
async function buildGraph(vectorStore) {
    const retrieveTool = getRetrieveTool(vectorStore);
    const graph = new langgraph_1.StateGraph(langgraph_1.MessagesAnnotation)
        .addNode("queryOrRespond", queryOrRespondNode(retrieveTool))
        .addNode("tools", new prebuilt_1.ToolNode([retrieveTool]))
        .addNode("generate", generate)
        .addEdge("__start__", "queryOrRespond")
        .addConditionalEdges("queryOrRespond", prebuilt_2.toolsCondition, {
        __end__: "__end__",
        tools: "tools",
    })
        .addEdge("tools", "generate")
        .addEdge("generate", "__end__")
        .compile();
    return graph;
}
// Exported for Express to use
async function initGraph() {
    const docs = await loadAndSplitDocs();
    const vectorStore = new memory_1.MemoryVectorStore(embeddings);
    await vectorStore.addDocuments(docs);
    const graph = await buildGraph(vectorStore);
    return graph;
}
exports.prePrompt = new messages_1.SystemMessage(`You are a helpful and friendly AI support assistant. 
Answer user questions accurately and concisely using the provided support materials. 
If information is missing or unclear, politely inform the user and suggest they provide more details. `);
