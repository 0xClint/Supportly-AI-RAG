import dotenv from "dotenv";
dotenv.config();

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { z } from "zod";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BedrockEmbeddings } from "@langchain/aws";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";

import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { toolsCondition } from "@langchain/langgraph/prebuilt";

// LLM
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0,
});

// Embeddings model
const embeddings = new BedrockEmbeddings({
  model: "amazon.titan-embed-text-v1",
  region: process.env.BEDROCK_AWS_REGION || "",
  credentials: {
    accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY || "",
  },
});

// Load and split documents
async function loadAndSplitDocs(): Promise<Document[]> {
  const loader = new PuppeteerWebBaseLoader("https://omkar-ten.vercel.app/", {
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
        if (main && main.innerText.trim()) return main.innerText;
        const body = document.querySelector("body");
        return body ? body.innerText : "";
      });
      return content || "No content extracted.";
    },
  });

  const rawDocs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const splitDocs = await splitter.splitDocuments(rawDocs);
  return splitDocs;
}

// Tool for retrieving context from vector store
function getRetrieveTool(vectorStore: MemoryVectorStore) {
  return tool(
    async ({ query }: { query: string }) => {
      const retrievedDocs = await vectorStore.similaritySearch(query, 4);
      const serialized = retrievedDocs
        .map(
          (doc) =>
            `Source: ${doc.metadata?.source || "web"}\nContent: ${
              doc.pageContent
            }`
        )
        .join("\n");
      return [serialized, retrievedDocs];
    },
    {
      name: "retrieve",
      description: "Retrieve information related to a query.",
      schema: z.object({ query: z.string() }),
      responseFormat: "content_and_artifact",
    }
  );
}

// Step 1: Generate query or direct response
function queryOrRespondNode(retrieveTool: ReturnType<typeof getRetrieveTool>) {
  return async (state: typeof MessagesAnnotation.State) => {
    const llmWithTools = llm.bindTools([retrieveTool]);
    const response = await llmWithTools.invoke(state.messages);
    return { messages: [response] };
  };
}

// Step 2: Generate final answer
async function generate(state: typeof MessagesAnnotation.State) {
  const toolMessages = state.messages.filter((m) => m instanceof ToolMessage);
  const docsText = toolMessages.map((msg) => msg.content).join("\n");

  const systemMessage = new SystemMessage(
    `You are a helpful and friendly AI support assistant. 
Answer user questions accurately and concisely using the provided support materials. 
If information is missing or unclear, politely inform the user and suggest they provide more details. Be concise and informative.\n\n${docsText}`
  );

  const convo = state.messages.filter(
    (msg) =>
      msg instanceof HumanMessage ||
      (msg instanceof AIMessage && (msg.tool_calls?.length ?? 0) === 0)
  );

  const prompt = [systemMessage, ...convo];
  const response = await llm.invoke(prompt);
  return { messages: [response] };
}

// Build LangGraph
async function buildGraph(vectorStore: MemoryVectorStore) {
  const retrieveTool = getRetrieveTool(vectorStore);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("queryOrRespond", queryOrRespondNode(retrieveTool))
    .addNode("tools", new ToolNode([retrieveTool]))
    .addNode("generate", generate)
    .addEdge("__start__", "queryOrRespond")
    .addConditionalEdges("queryOrRespond", toolsCondition, {
      __end__: "__end__",
      tools: "tools",
    })
    .addEdge("tools", "generate")
    .addEdge("generate", "__end__")
    .compile();

  return graph;
}

// Exported for Express to use
export async function initGraph() {
  const docs = await loadAndSplitDocs();
  const vectorStore = new MemoryVectorStore(embeddings);
  await vectorStore.addDocuments(docs);
  const graph = await buildGraph(vectorStore);
  return graph;
}

export const prePrompt = new SystemMessage(
  `You are a helpful and friendly AI support assistant. 
Answer user questions accurately and concisely using the provided support materials. 
If information is missing or unclear, politely inform the user and suggest they provide more details. `
);
