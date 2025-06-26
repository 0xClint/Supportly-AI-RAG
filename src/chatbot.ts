import dotenv from "dotenv";
dotenv.config();
import { z } from "zod";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BedrockEmbeddings } from "@langchain/aws";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { pull } from "langchain/hub";
import { StateGraph } from "@langchain/langgraph";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createFile, loadJsonFromTextFile } from "./utils";

//chat model
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0,
});

//AI model
export const embeddings = new BedrockEmbeddings({
  model: "amazon.titan-embed-text-v1",
  region: process.env.BEDROCK_AWS_REGION || "",
  credentials: {
    accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY || "",
  },
});

async function loadAndSplitDocs(): Promise<Document[]> {
  // const loader = new CheerioWebBaseLoader("https://omkar-ten.vercel.app/", {
  //   selector: "p",
  // });
  const loader = new PuppeteerWebBaseLoader(
    "https://lilianweng.github.io/posts/2023-06-23-agent/",
    {
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
    }
  );
  const rawDocs = await loader.load();

  // console.log("📄 Loaded content preview:\n", rawDocs);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const splitDAta = await splitter.splitDocuments(rawDocs);
  createFile(splitDAta);
  // console.log("📄 Loaded splitter preview:\n");

  return splitter.splitDocuments(rawDocs);
}

const InputSchema = z.object({
  question: z.string(),
});

const FullStateSchema = z.object({
  question: z.string(),
  context: z.array(z.any()), // Optionally replace z.any() with a specific shape if needed
  answer: z.string(),
});

export async function buildGraph(vectorStore: MemoryVectorStore) {
  const promptTemplate = await pull<ChatPromptTemplate>("rlm/rag-prompt");

  const retrieve = async (state: z.infer<typeof InputSchema>) => {
    const context = await vectorStore.similaritySearch(state.question, 4);
    return { context };
  };

  const generate = async (state: z.infer<typeof FullStateSchema>) => {
    const docsText = state.context
      .map((doc: Document) => doc.pageContent)
      .join("\n");

    const messages = await promptTemplate.formatMessages({
      question: state.question,
      context: docsText,
    });

    const result = await llm.invoke(messages);
    return { answer: result.content as string };
  };

  const graph = new StateGraph(FullStateSchema)
    .addNode("retrieve", retrieve)
    .addNode("generate", generate)
    .addEdge("__start__", "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", "__end__")
    .compile();

  return graph;
}

export async function initGraph(docs: Document[]) {
  // const docs = await loadAndSplitDocs();
  // console.log(docs);
  // const docs = await loadJsonFromTextFile("vector-response.txt");

  const vectorStore = new MemoryVectorStore(embeddings);
  await vectorStore.addDocuments(docs);
  const graph = await buildGraph(vectorStore);
  return graph;
}

// initGraph()
