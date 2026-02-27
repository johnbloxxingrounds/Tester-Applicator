// bot.js
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch"); // npm install node-fetch@2
const BOT_SECRET = process.env.BOT_SECRET || "supersecret";
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const VOTE_CHANNEL_ID = "YOUR_CHANNEL_ID";
const POLL_INTERVAL = 15000; // 15 seconds
const REQUIRED_VOTES = 5;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const voteTracker = new Map();

client.once("ready", () => {
  console.log("Bot online as", client.user.tag);
  pollSheet();
});

async function pollSheet() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET })
    });

    const json = await res.json();

    if (json.row && json.fields) {
      const channel = await client.channels.fetch(VOTE_CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle("📋 New Tester Application")
        .setColor(0x5865F2)
        .setFooter({ text: `Sheet Row #${json.row} • React below to vote` })
        .setTimestamp()
        .addFields(json.fields);

      const msg = await channel.send({ embeds: [embed] });
      await msg.react("✅");
      await msg.react("❌");

      voteTracker.set(msg.id, { approve: new Set(), deny: new Set(), row: json.row });
    }
  } catch (err) {
    console.error("Polling error:", err);
  } finally {
    setTimeout(pollSheet, POLL_INTERVAL);
  }
}

// Voting logic
client.on("messageReactionAdd", async (reaction, user) => handleVote(reaction, user, true));
client.on("messageReactionRemove", async (reaction, user) => handleVote(reaction, user, false));

async function handleVote(reaction, user, added) {
  if (user.bot || reaction.message.channelId !== VOTE_CHANNEL_ID) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const votes = voteTracker.get(reaction.message.id);
  if (!votes) return;

  const emoji = reaction.emoji.name;
  if (emoji === "✅") {
    added ? votes.approve.add(user.id) : votes.approve.delete(user.id);
    votes.deny.delete(user.id);
  } else if (emoji === "❌") {
    added ? votes.deny.add(user.id) : votes.deny.delete(user.id);
    votes.approve.delete(user.id);
  } else return;

  if (votes.approve.size >= REQUIRED_VOTES) {
    await submitDecision(votes.row, "Accepted", reaction.message);
    voteTracker.delete(reaction.message.id);
  } else if (votes.deny.size >= REQUIRED_VOTES) {
    await submitDecision(votes.row, "Denied", reaction.message);
    voteTracker.delete(reaction.message.id);
  }
}

async function submitDecision(row, decision, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET, row, decision })
    });
    const json = await res.json();
    console.log(`Row ${row} marked ${decision}`, json);
    await message.reply(`${decision === "Accepted" ? "✅" : "❌"} **${decision}** — Row #${row} updated.`);
  } catch (err) {
    console.error("Failed to update sheet:", err);
  }
}

client.login(DISCORD_TOKEN);
