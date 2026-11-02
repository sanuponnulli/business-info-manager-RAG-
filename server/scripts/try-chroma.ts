/**
 * Manual check for Chunk 1: connects to ChromaDB, creates (or opens) the
 * handbook collection and prints its settings.
 *
 *   npx tsx --env-file=.env scripts/try-chroma.ts
 */
import { chroma, getCollection } from "../src/clients/chroma.js";

const beat = await chroma.heartbeat();
console.log("Chroma heartbeat:", beat);

const collection = await getCollection();
console.log("Collection:", collection.name);
console.log("Vectors stored:", await collection.count());
console.log("Configuration:", JSON.stringify(collection.configuration, null, 2));
