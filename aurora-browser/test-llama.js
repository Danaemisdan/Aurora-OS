async function main() {
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: "/Users/sanjeevn/Models/llm/phi-3-mini-4k-instruct-q4.gguf" });
    const context = await model.createContext({ contextSize: 1024, sequences: 1 });
    const sequence = context.getSequence();
    console.log("Has clearHistory?", typeof sequence.clearHistory);
    process.exit(0);
}
main().catch(console.error);
