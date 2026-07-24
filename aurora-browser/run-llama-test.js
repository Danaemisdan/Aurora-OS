const path = require('path');

async function testLlama() {
    console.log("Loading Llama...");
    const llamaNode = await import("node-llama-cpp");
    const getLlama = llamaNode.getLlama;
    const LlamaChatSession = llamaNode.LlamaChatSession;

    const llama = await getLlama();
    const modelPath = path.join(__dirname, 'Add-Ons', 'Aurora AI', 'qwen2.5-3b-instruct-q4_k_m.gguf');

    console.log("Loading model:", modelPath);
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext();
    const session = new LlamaChatSession({
        contextSequence: context.getSequence()
    });

    console.log("Prompting...");
    const res = await session.prompt("Output a JSON object with { \"hello\": \"world\" }");
    console.log("Result Type:", typeof res);
    console.log("Result:", res);
}

testLlama().catch(console.error);
