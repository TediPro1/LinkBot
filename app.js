const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000; // Railway requires this

const DISCORD_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LINKED_ROLE_NAME = '✅ Linked';

const discordToMc = JSON.parse(
    fs.existsSync('linked_users.json') ? fs.readFileSync('linked_users.json') : '{}'
);

app.use(bodyParser.json());

// Log all incoming requests for debugging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Ready
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`));
});

// ✅ Health check endpoint
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Minecraft -> Discord chat
app.post('/mc-chat', async (req, res) => {
    const { username, message } = req.body;
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        channel.send(`<${username}> ${message}`);
        res.sendStatus(200);
    } catch (error) {
        console.error('Failed to send mc-chat message:', error);
        res.sendStatus(500);
    }
});

// Player join: assign role and announce
app.post('/player-join', async (req, res) => {
    const { mc_username, discord_id } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discord_id);

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
        console.error('player-join error:', err);
        res.sendStatus(500);
    }
});

// Discord -> Minecraft (RCON or socket TODO)
client.on('messageCreate', async msg => {
    if (msg.channel.id !== CHANNEL_ID || msg.author.bot) return;

    const linkedMcUsername = discordToMc[msg.author.id];
    if (!linkedMcUsername) {
        msg.reply('❌ You haven’t linked your Minecraft account. Use `/link` in-game.');
        return;
    }

    const formatted = `<${linkedMcUsername}> ${msg.content}`;
    console.log('Discord -> Minecraft:', formatted);

    // TODO: Send to Minecraft via RCON or WebSocket
});

client.login(DISCORD_TOKEN);
