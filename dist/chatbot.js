"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddings = void 0;
exports.buildGraph = buildGraph;
exports.initGraph = initGraph;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const zod_1 = require("zod");
const google_genai_1 = require("@langchain/google-genai");
const aws_1 = require("@langchain/aws");
const memory_1 = require("langchain/vectorstores/memory");
const puppeteer_1 = require("@langchain/community/document_loaders/web/puppeteer");
const hub_1 = require("langchain/hub");
const langgraph_1 = require("@langchain/langgraph");
const textsplitters_1 = require("@langchain/textsplitters");
const utils_1 = require("./utils");
//chat model
const llm = new google_genai_1.ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0,
});
//AI model
exports.embeddings = new aws_1.BedrockEmbeddings({
    model: "amazon.titan-embed-text-v1",
    region: process.env.BEDROCK_AWS_REGION || "",
    credentials: {
        accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY || "",
    },
});
async function loadAndSplitDocs() {
    // const loader = new CheerioWebBaseLoader("https://omkar-ten.vercel.app/", {
    //   selector: "p",
    // });
    const loader = new puppeteer_1.PuppeteerWebBaseLoader("https://lilianweng.github.io/posts/2023-06-23-agent/", {
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
    // console.log("📄 Loaded content preview:\n", rawDocs);
    const splitter = new textsplitters_1.RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const splitDAta = await splitter.splitDocuments(rawDocs);
    (0, utils_1.createFile)(splitDAta);
    // console.log("📄 Loaded splitter preview:\n");
    return splitter.splitDocuments(rawDocs);
}
const InputSchema = zod_1.z.object({
    question: zod_1.z.string(),
});
const FullStateSchema = zod_1.z.object({
    question: zod_1.z.string(),
    context: zod_1.z.array(zod_1.z.any()), // Optionally replace z.any() with a specific shape if needed
    answer: zod_1.z.string(),
});
async function buildGraph(vectorStore) {
    const promptTemplate = await (0, hub_1.pull)("rlm/rag-prompt");
    const retrieve = async (state) => {
        const context = await vectorStore.similaritySearch(state.question, 4);
        return { context };
    };
    const generate = async (state) => {
        const docsText = state.context
            .map((doc) => doc.pageContent)
            .join("\n");
        const messages = await promptTemplate.formatMessages({
            question: state.question,
            context: docsText,
        });
        const result = await llm.invoke(messages);
        return { answer: result.content };
    };
    const graph = new langgraph_1.StateGraph(FullStateSchema)
        .addNode("retrieve", retrieve)
        .addNode("generate", generate)
        .addEdge("__start__", "retrieve")
        .addEdge("retrieve", "generate")
        .addEdge("generate", "__end__")
        .compile();
    return graph;
}
async function initGraph(docs) {
    // const docs = await loadAndSplitDocs();
    // console.log(docs);
    // const docs = await loadJsonFromTextFile("vector-response.txt");
    const vectorStore = new memory_1.MemoryVectorStore(exports.embeddings);
    await vectorStore.addDocuments(docs);
    const graph = await buildGraph(vectorStore);
    return graph;
}
// initGraph()
