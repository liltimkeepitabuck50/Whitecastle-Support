// =========================
// WhiteCastle Restaurant RBLX Support Bot
// Discord.js v14 + Express keep-alive
// =========================

require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField
} = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// =========================
// Data Stores
// =========================
const tickets = new Map();
const pastTickets = new Map();
const snippets = new Map();
const lastTextMessageByUser = new Map();

// =========================
// Helper Functions
// =========================
function getMainGuild() {
    return client.guilds.cache.get(process.env.GUILD_ID);
}

async function getHighestRoleName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.roles.highest?.name || 'No Rank';
    } catch {
        return 'No Rank';
    }
}

function createSupportEmbed(member, content) {
    const timestamp = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`${member.user.username}`)
        .setDescription(content)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `${member.roles.highest.name} | ${timestamp}` });
}

// =========================
// Ready
// =========================
client.once('ready', () => {
    console.log(`WhiteCastle Restaurant RBLX Support Bot is online as ${client.user.tag}`);
});

// =========================
// Message Create
// =========================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!message.content.startsWith('.') && message.content.trim().length > 0) {
        lastTextMessageByUser.set(message.author.id, message.content);
    }

    if (message.channel.type === 1) {
        await handleDM(message);
        return;
    }

    if (!message.content.startsWith('.')) return;
    const args = message.content.slice(1).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    switch (command) {
        case 'help': return handleHelp(message);
        case 'reply': return handleReply(message, args);
        case 'claim': return handleClaim(message);
        case 'unclaim': return handleUnclaim(message);
        case 'close': return handleClose(message);
        case 'snippet': return handleSnippet(message, args);
        case 'escalate': return handleEscalate(message, args);
    }
});

// =========================
// DM Handler
// =========================
async function handleDM(message) {
    const userId = message.author.id;
    const content = message.content || '[No content]';
    try { await message.react('✅'); } catch {}

    let ticket = tickets.get(userId);
    if (!ticket) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_confirm').setLabel('✔️ Confirm').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('ticket_cancel').setLabel('✖️ Cancel').setStyle(ButtonStyle.Danger)
        );

        const starterEmbed = new EmbedBuilder()
            .setTitle('Open a Support Ticket?')
            .setColor(0x2B2D31)
            .setDescription('Press ✔️ to open a ticket or ✖️ to cancel.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        const starterMsg = await message.channel.send({ embeds: [starterEmbed], components: [row] });
        tickets.set(userId, { channelId: null, initialMessage: content, messages: [], claimedBy: null, escalatedTo: null, starterMessageId: starterMsg.id });
        return;
    }

    if (ticket.channelId) {
        const guild = getMainGuild();
        if (!guild) return;
        const supportChannel = guild.channels.cache.get(ticket.channelId);
        if (!supportChannel) return;

        ticket.messages.push({ from: 'user', content, timestamp: Date.now() });
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;
        const embed = createSupportEmbed(member, content);
        await supportChannel.send({ embeds: [embed] });
    }
}

// =========================
// Interaction Create
// =========================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const userId = interaction.user.id;
    const ticket = tickets.get(userId);
    if (!ticket) return;

    if (interaction.customId === 'ticket_cancel') {
        tickets.delete(userId);
        const cancelEmbed = new EmbedBuilder()
            .setTitle('Ticket Canceled')
            .setColor(0xFF0000)
            .setDescription('Your ticket has been canceled.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });
        await interaction.update({ embeds: [cancelEmbed], components: [] });
        return;
    }

    if (interaction.customId === 'ticket_confirm') {
        const guild = getMainGuild();
        const user = await client.users.fetch(userId);
        const member = await guild.members.fetch(userId).catch(() => null);
        const highestRole = member ? member.roles.highest?.name || 'No Rank' : 'No Rank';
        const channelName = `support-${user.username}`;
        const supportChannel = await guild.channels.create({
            name: channelName,
            type: 0,
            parent: process.env.SUPPORT_CATEGORY_ID,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: process.env.SUPPORT_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
            ]
        });

        const history = pastTickets.get(userId) || [];
        const pastText = history.length ? `Past Tickets:\n${history.map(n => `- ${n}`).join('\n')}` : 'Past Tickets:\nNone';
        const infoEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle(`${user.username} (${user.tag})`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User ID', value: `${user.id}`, inline: true },
                { name: 'Initial Message', value: ticket.initialMessage, inline: false },
                { name: 'History', value: pastText, inline: false }
            )
            .setFooter({ text: `Rank: ${highestRole}` });

        await supportChannel.send({ content: `<@&${process.env.SUPPORT_ROLE_ID}>`, embeds: [infoEmbed] });
        ticket.channelId = supportChannel.id;
        history.push(channelName);
        pastTickets.set(userId, history);

        const confirmEmbed = new EmbedBuilder()
            .setTitle('Ticket Created')
            .setColor(0x00FF00)
            .setDescription('Your ticket has been created. A staff member will contact you shortly.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });
        await interaction.update({ embeds: [confirmEmbed], components: [] });
    }
});

// =========================
// Commands
// =========================
async function handleHelp(message) {
    const helpEmbed = new EmbedBuilder()
        .setTitle('WhiteCastle Support Commands')
        .setColor(0x2B2D31)
        .setDescription([
            '**.help** - Show this list',
            '**.reply <message>** - Reply to the ticket user',
            '**.claim / .unclaim / .close** - Manage tickets',
            '**.snippet add <name>** - Add snippet using your last message',
            '**.snippet <name>** - Send snippet to user (DM)',
            '**.escalate ticket pr / staffing** - Escalate ticket'
        ].join('\n'))
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });
    await message.channel.send({ embeds: [helpEmbed] });
}

async function handleReply(message, args) {
    const data = [...tickets.entries()].find(([_, t]) => t.channelId === message.channel.id);
    if (!data) return;
    const [userId, ticket] = data;
    const replyText = args.join(' ');
    if (!replyText) return;
    const guild = getMainGuild();
    const member = await guild.members.fetch(userId);
    const embed = createSupportEmbed(member, replyText);
    try { await message.delete(); } catch {}
    await message
