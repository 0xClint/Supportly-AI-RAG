"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFile = void 0;
exports.loadJsonFromTextFile = loadJsonFromTextFile;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const createFile = async (response) => {
    const filePath = path_1.default.join(__dirname, "vector-response.txt");
    await promises_1.default.writeFile(filePath, JSON.stringify(response, null, 2), "utf-8");
    console.log("✅ Response saved to vector-response.txt");
};
exports.createFile = createFile;
async function loadJsonFromTextFile(fileName) {
    const filePath = path_1.default.join(__dirname, fileName);
    const fileContent = await promises_1.default.readFile(filePath, "utf-8");
    const jsonData = JSON.parse(fileContent);
    return jsonData;
}
