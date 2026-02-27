// bot.js
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import fetch from "node-fetch"; // If Node < 18

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // your Apps Script URL
const VOTE_CHANNEL_ID = "1476702659653275718";
const REQUIRED_VOTES = 5;
const POLL_INTERVAL = 15000; // 15 seconds
const BOT_SECRET = process.env.BOT_SECRET || "supersecret";

const voteTracker = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================
// Helper: extract row number from embed footer
// ==========================
function extractRow(message) {
  const embed = message.embeds?.[0];
  if (!embed?.footer?.text) return null;
  const match = embed.footer.text.match(/Sheet Row #(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// ==========================
// Submit a decision to the Apps Script
// ==========================
async function submitDecision(row, decision, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET, row, decision })
    });
    const json = await res.json();
    console.log("Sheet updated:", json);

    const emoji = decision === "Accepted" ? "✅" : "❌";
    await message.reply(`${emoji} **${decision}** — Row #${row} updated.`);
  } catch (err) {
    console.error("Failed to update sheet:", err);
  }
}

// ==========================
// Poll Apps Script for new rows
// ==========================
async function pollSheet() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET })
    });

    const data = await res.json();
    if (!data.row) return; // no new submissions

    const fields = data.headers.map((h, i) => ({
      name: h,
      value: String(data.values[i] || "N/A").substring(0, 1024),
      inline: true
    }));

    const embed = new EmbedBuilder()
      .setTitle("📋 New Tester Application")
      .setColor(0x5865F2)
      .setFooter({ text: `Sheet Row #${data.row} • React below to vote` })
      .setTimestamp()
      .addFields(fields);

    const channel = await client.channels.fetch(VOTE_CHANNEL_ID);
    const msg = await channel.send({ embeds: [embed] });
    await msg.react("✅");
    await msg.react("❌");

    // Mark as posted
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET, row: data.row, decision: "Posted" })
    });
  } catch (err) {
    console.error("Polling error:", err);
  }
}

// ==========================
// Handle reactions (votes)
// ==========================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot || reaction.message.channelId !== VOTE_CHANNEL_ID) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const message = reaction.message;
  const emoji = reaction.emoji.name;
  const messageId = message.id;
  const row = extractRow(message);
  if (!row) return;

  if (!voteTracker.has(messageId)) voteTracker.set(messageId, { approve: new Set(), deny: new Set(), row });

  const votes = voteTracker.get(messageId);
  if (emoji === "✅") { votes.deny.delete(user.id); votes.approve.add(user.id); }
  if (emoji === "❌") { votes.approve.delete(user.id); votes.deny.add(user.id); }

  if (votes.approve.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Accepted", message);
  } else if (votes.deny.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Denied", message);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot || reaction.message.channelId !== VOTE_CHANNEL_ID) return;
  if (reaction.partial) await reaction.fetch();

  const votes = voteTracker.get(reaction.message.id);
  if (!votes) return;
  if (reaction.emoji.name === "✅") votes.approve.delete(user.id);
  if (reaction.emoji.name === "❌") votes.deny.delete(user.id);
});

// ==========================
// Start bot and polling
// ==========================
client.once("ready", () => {
  console.log("Bot online as " + client.user.tag);
  setInterval(pollSheet, POLL_INTERVAL);
});

client.login(DISCORD_TOKEN);
