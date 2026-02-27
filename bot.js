// bot.js
const { Client, GatewayIntentBits, Partials } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const VOTE_CHANNEL_ID = "1476702659653275718";
const REQUIRED_VOTES = 5;

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

client.once("ready", () => {
  console.log("Bot online as " + client.user.tag);
});

client.on("error", (err) => console.error("Client error:", err));
client.on("warn", (info) => console.warn("Client warn:", info));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

function extractRow(message) {
  const embed = message.embeds && message.embeds[0];
  if (!embed || !embed.footer || !embed.footer.text) return null;
  const match = embed.footer.text.match(/Sheet Row #(\d+)/);
  return match ? parseInt(match[1]) : null;
}

async function submitDecision(row, decision, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: row, decision: decision })
    });
    const json = await res.json();
    console.log("Sheet updated:", json);
    const emoji = decision === "Accepted" ? "✅" : "❌";
    await message.reply(emoji + " **" + decision + "** — Row #" + row + " has been updated. Next application incoming...");
  } catch (err) {
    console.error("Failed to update sheet:", err);
  }
}

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.channelId !== VOTE_CHANNEL_ID) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch (e) { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch (e) { return; }
  }

  const message = reaction.message;
  const emoji = reaction.emoji.name;
  const messageId = message.id;
  const row = extractRow(message);
  if (!row) return;

  if (!voteTracker.has(messageId)) {
    voteTracker.set(messageId, { approve: new Set(), deny: new Set(), row: row });
  }

  const votes = voteTracker.get(messageId);

  if (emoji === "✅") {
    votes.deny.delete(user.id);
    votes.approve.add(user.id);
  } else if (emoji === "❌") {
    votes.approve.delete(user.id);
    votes.deny.add(user.id);
  } else {
    return;
  }

  console.log("Row " + row + " — Approve: " + votes.approve.size + " Deny: " + votes.deny.size);

  if (votes.approve.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Accepted", message);
  } else if (votes.deny.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Denied", message);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.channelId !== VOTE_CHANNEL_ID) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch (e) { return; }
  }

  const messageId = reaction.message.id;
  const emoji = reaction.emoji.name;

  if (!voteTracker.has(messageId)) return;

  const votes = voteTracker.get(messageId);
  if (emoji === "✅") votes.approve.delete(user.id);
  if (emoji === "❌") votes.deny.delete(user.id);
});

client.login(DISCORD_TOKEN).catch(err => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
