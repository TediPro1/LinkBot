const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const PORT = 3000;

const DISCORD_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LINKED_ROLE_NAME = '✅ Linked';
const discordToMc = JSON.parse(fs.existsSync('linked_users.json') ? fs.readFileSync('linked_users.json') : '{}');

app.use(bodyParser.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    app.listen(PORT, () => console.log(`Webhook server running on port ${PORT}`));
});

// Handle messages from Minecraft -> Discord
app.post('/mc-chat', async (req, res) => {
    const { username, message } = req.body;
    const channel = await client.channels.fetch(CHANNEL_ID);
    channel.send(`<${username}> ${message}`);
    res.sendStatus(200);
});

// Handle player join: assign role, announce
app.post('/player-join', async (req, res) => {
    const { mc_username, discord_id } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discord_id);

        // Save mapping if not present
        if (!discordToMc[discord_id]) {
            discordToMc[discord_id] = mc_username;
            fs.writeFileSync('linked_users.json', JSON.stringify(discordToMc, null, 2));
        }

        const role = guild.roles.cache.find(r => r.name === LINKED_ROLE_NAME);
        if (role && !member.roles.cache.has(role.id)) {
            await member.roles.add(role);
        }

        const channel = await client.channels.fetch(CHANNEL_ID);
        channel.send(`🎮 <${mc_username}> joined the Minecraft server!`);

        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.sendStatus(500);
    }
});

// Handle Discord -> Minecraft chat relay (e.g., via RCON or external)
client.on('messageCreate', async msg => {
    if (msg.channel.id !== CHANNEL_ID || msg.author.bot) return;

    const linkedMcUsername = discordToMc[msg.author.id];
    if (!linkedMcUsername) {
        msg.reply('❌ You haven’t linked your Minecraft account. Use `/link` in-game.');
        return;
    }

    const formatted = `<${linkedMcUsername}> ${msg.content}`;
    console.log('Discord -> MC:', formatted);

    // TODO: send to Minecraft via RCON or socket
});
app.get('/ping', (req, res) => {
    res.sendStatus(200); // or res.send("pong");
});

client.login(DISCORD_TOKEN);
