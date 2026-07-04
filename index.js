const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
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

const PREFIX = '.';
const SUPPORT_ROLE_ID = '000000000000000000';      // replace with @Support Team Role ID
const SUPPORT_CATEGORY_ID = '000000000000000000';  // replace with support category ID
const LOG_CHANNEL_ID = '000000000000000000';       // replace with transcript/log channel ID

// ticket data: userId -> { channelId, messages: [], claimedBy, escalatedRoleId }
const tickets = new Map();
// past tickets: userId -> [channelName]
const pastTickets = new Map();
// snippets: guildId -> { name: content }
const snippets = new Map();
// snippet pending input: userId -> { guildId, name, mode }
const snippetPending = new Map();

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // DM FLOW: react with green check on EVERY DM message
    if (message.channel.type === 1) { // DM
        try {
            await message.react('✅');
        } catch {}

        // starter ticket flow: if user has no active ticket, send starter embed
        const existing = tickets.get(message.author.id);
        if (!existing) {
            const user = message.author;
            const initialMessage = message.content || '[No content]';

            const past = pastTickets.get(user.id) || [];
            const pastText = past.length
                ? `Past Tickets Created:\n${past.map(n => `- ${n}`).join('\n')}`
                : 'Past Tickets Created:\nNone';

            const starterEmbed = new EmbedBuilder()
                .setTitle('Support Ticket Creation')
                .setColor(0x0000FF)
                .setThumbnail(user.displayAvatarURL({ size: 256 }))
                .addFields(
                    { name: 'User', value: `${user.username}`, inline: true },
                    { name: 'User ID', value: `${user.id}`, inline: true },
                    { name: 'Initial Message', value: initialMessage },
                    { name: 'History', value: pastText }
                )
                .setFooter({ text: 'Moonbeam Staff Team | Use .help to see a list of commands.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_confirm')
                    .setLabel('✔️ Confirm')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('ticket_cancel')
                    .setLabel('✖️ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

            const supportRoleMention = `<@&${SUPPORT_ROLE_ID}>`;
            const starterMsg = await message.channel.send({ content: supportRoleMention, embeds: [starterEmbed], components: [row] });
            try {
                await starterMsg.react('✅');
            } catch {}

            tickets.set(user.id, {
                channelId: null,
                messages: [],
                claimedBy: null,
                escalatedRoleId: null,
                starterMessageId: starterMsg.id
            });

            return;
        }

        // relay DM messages to ticket channel if exists
        if (existing && existing.channelId) {
            const guild = client.guilds.cache.find(g => g.channels.cache.has(existing.channelId));
            if (!guild) return;
            const channel = guild.channels.cache.get(existing.channelId);
            if (!channel) return;

            existing.messages.push({
                from: 'user',
                content: message.content || '[No content]',
                timestamp: Date.now()
            });

            const relayEmbed = new EmbedBuilder()
                .setTitle('Message from Ticket Opener')
                .setColor(0x0000FF)
                .setDescription(message.content || '[No content]')
                .setFooter({ text: `Moonbeam Staff Team | Use .help to see a list of commands.` });

            await channel.send({ embeds: [relayEmbed] });
            return;
        }

        return;
    }

    // GUILD MESSAGE COMMANDS
    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    const guild = message.guild;
    if (!guild) return;

    // ensure snippet storage
    if (!snippets.has(guild.id)) snippets.set(guild.id, {});

    // handle snippet pending input
    const pending = snippetPending.get(message.author.id);
    if (pending && !message.content.startsWith(PREFIX)) {
        const store = snippets.get(pending.guildId);
        if (pending.mode === 'add' || pending.mode === 'edit') {
            store[pending.name] = message.content;
            await message.reply(`Snippet "${pending.name}" ${pending.mode === 'add' ? 'created' : 'updated'} successfully.`);
        }
        snippetPending.delete(message.author.id);
        return;
    }

    // .help
    if (cmd === 'help') {
        const helpText = [
            '**Available Commands:**',
            '.help - Show this help message',
            '.reply <message> - Reply to the ticket opener',
            '.claim - Claim the current ticket',
            '.unclaim - Unclaim the current ticket',
            '.escalate ticket pr - Escalate ticket to PR',
            '.escalate ticket staffing - Escalate ticket to Staffing',
            '.snippet add <name> - Create a new snippet (next message is content)',
            '.snippet edit <name> - Edit an existing snippet (next message is content)',
            '.snippet remove <name> - Remove a snippet',
            '.snippet list - List all snippet names',
            '.snippet <name> - Send a snippet to the ticket opener',
            '.close - Close the ticket and generate transcript'
        ].join('\n');

        await message.reply(helpText);
        return;
    }

    // find ticket by channel
    let ticketOwnerId = null;
    for (const [userId, data] of tickets.entries()) {
        if (data.channelId === message.channel.id) {
            ticketOwnerId = userId;
            break;
        }
    }

    // commands that require ticket context
    if (['reply', 'claim', 'unclaim', 'escalate', 'close'].includes(cmd) && !ticketOwnerId) {
        await message.reply('This channel is not linked to a support ticket.');
        return;
    }

    // .reply <message>
    if (cmd === 'reply') {
        const replyText = args.join(' ');
        if (!replyText) {
            await message.reply('Please provide a message to send to the ticket opener.');
            return;
        }

        const ticket = tickets.get(ticketOwnerId);
        const user = await client.users.fetch(ticketOwnerId).catch(() => null);
        if (!user) {
            await message.reply('Could not find the ticket opener.');
            return;
        }

        ticket.messages.push({
            from: 'staff',
            content: replyText,
            timestamp: Date.now()
        });

        const relayEmbed = new EmbedBuilder()
            .setTitle('Message from Staff')
            .setColor(0x0000FF)
            .setDescription(replyText)
            .setFooter({ text: `Moonbeam Staff Team | Use .help to see a list of commands.` });

        await user.send({ embeds: [relayEmbed] }).catch(() => {});
        await message.channel.send({ embeds: [relayEmbed] });
        return;
    }

    // .claim
    if (cmd === 'claim') {
        const ticket = tickets.get(ticketOwnerId);
        if (ticket.claimedBy) {
            await message.reply(`This ticket is already claimed by <@${ticket.claimedBy}>.`);
            return;
        }
        ticket.claimedBy = message.author.id;
        await message.reply(`You have claimed this ticket.`);
        return;
    }

    // .unclaim
    if (cmd === 'unclaim') {
        const ticket = tickets.get(ticketOwnerId);
        if (!ticket.claimedBy) {
            await message.reply('This ticket is not claimed.');
            return;
        }
        if (ticket.claimedBy !== message.author.id) {
            await message.reply('You are not the staff member who claimed this ticket.');
            return;
        }
        ticket.claimedBy = null;
        await message.reply('You have unclaimed this ticket.');
        return;
    }

    // .escalate ticket pr / staffing
    if (cmd === 'escalate') {
        const ticket = tickets.get(ticketOwnerId);
        const sub = args.join(' ').toLowerCase();
        let roleId = null;
        if (sub === 'ticket pr') {
            roleId = '000000000000000001'; // replace with PR role ID
        } else if (sub === 'ticket staffing') {
            roleId = '000000000000000002'; // replace with Staffing role ID
        } else {
            await message.reply('Usage: .escalate ticket pr OR .escalate ticket staffing');
            return;
        }

        ticket.escalatedRoleId = roleId;

        const channel = message.channel;
        await channel.permissionOverwrites.set([
            {
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: SUPPORT_ROLE_ID,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            },
            {
                id: roleId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            }
        ]);

        await message.reply('Ticket escalated.');
        return;
    }

    // .close (auto transcript)
    if (cmd === 'close') {
        const ticket = tickets.get(ticketOwnerId);
        const channel = message.channel;

        const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
        const user = await client.users.fetch(ticketOwnerId).catch(() => null);

        const transcriptLines = ticket.messages.map(m => {
            const time = new Date(m.timestamp).toISOString();
            return `[${time}] ${m.from.toUpperCase()}: ${m.content}`;
        });

        const transcriptText = transcriptLines.length
            ? transcriptLines.join('\n')
            : 'No messages recorded in this ticket.';

        if (logChannel) {
            await logChannel.send({
                content: `Transcript for ticket channel ${channel.name} (user <@${ticketOwnerId}>):\n\`\`\`\n${transcriptText}\n\`\`\``
            });
        }

        if (user) {
            const closeEmbed = new EmbedBuilder()
                .setTitle('Ticket Closed')
                .setColor(0x00FF00)
                .setDescription('Your support ticket has been closed. Thank you for contacting us.')
                .setFooter({ text: 'Moonbeam Staff Team | Use .help to see a list of commands.' });

            await user.send({ embeds: [closeEmbed] }).catch(() => {});
        }

        const past = pastTickets.get(ticketOwnerId) || [];
        past.push(channel.name);
        pastTickets.set(ticketOwnerId, past);

        tickets.delete(ticketOwnerId);
        await channel.delete().catch(() => {});
        return;
    }

    // SNIPPET COMMANDS
    const guildSnippets = snippets.get(guild.id);

    // .snippet add <name>
    if (cmd === 'snippet' && args[0] === 'add') {
        const name = args[1];
        if (!name) {
            await message.reply('Please provide a snippet name. Usage: .snippet add <name>');
            return;
        }
        snippetPending.set(message.author.id, { guildId: guild.id, name, mode: 'add' });
        await message.reply(`Send the content for snippet "${name}" in your next message. It will be stored exactly as you send it.`);
        return;
    }

    // .snippet edit <name>
    if (cmd === 'snippet' && args[0] === 'edit') {
        const name = args[1];
        if (!name) {
            await message.reply('Please provide a snippet name. Usage: .snippet edit <name>');
            return;
        }
        if (!guildSnippets[name]) {
            await message.reply(`Snippet "${name}" does not exist.`);
            return;
        }
        snippetPending.set(message.author.id, { guildId: guild.id, name, mode: 'edit' });
        await message.reply(`Send the new content for snippet "${name}" in your next message. It will replace the existing content exactly as you send it.`);
        return;
    }

    // .snippet remove <name>
    if (cmd === 'snippet' && args[0] === 'remove') {
        const name = args[1];
        if (!name) {
            await message.reply('Please provide a snippet name. Usage: .snippet remove <name>');
            return;
        }
        if (!guildSnippets[name]) {
            await message.reply(`Snippet "${name}" does not exist.`);
            return;
        }
        delete guildSnippets[name];
        await message.reply(`Snippet "${name}" removed.`);
        return;
    }

    // .snippet list
    if (cmd === 'snippet' && args[0] === 'list') {
        const names = Object.keys(guildSnippets);
        if (!names.length) {
            await message.reply('No snippets have been created yet.');
            return;
        }
        const listText = ['Available snippets:', ...names.map(n => `- ${n}`)].join('\n');
        await message.reply(listText);
        return;
    }

    // .snippet <name>
    if (cmd === 'snippet' && args.length === 1) {
        const name = args[0];
        const content = guildSnippets[name];
        if (!content) {
            await message.reply(`Snippet "${name}" does not exist.`);
            return;
        }

        if (!ticketOwnerId) {
            await message.reply('This channel is not linked to a support ticket.');
            return;
        }

        const user = await client.users.fetch(ticketOwnerId).catch(() => null);
        if (!user) {
            await message.reply('Could not find the ticket opener.');
            return;
        }

        await user.send(content).catch(() => {});
        await message.channel.send(content);
        return;
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;
    if (!['ticket_confirm', 'ticket_cancel'].includes(customId)) return;

    const userId = interaction.user.id;
    const ticket = tickets.get(userId);
    if (!ticket) {
        await interaction.reply({ content: 'No ticket context found for this interaction.', ephemeral: true });
        return;
    }

    const starterMsg = await interaction.channel.messages.fetch(ticket.starterMessageId).catch(() => null);
    if (!starterMsg) {
        await interaction.reply({ content: 'Starter message not found.', ephemeral: true });
        return;
    }

    const embed = starterMsg.embeds[0];
    if (!embed) {
        await interaction.reply({ content: 'Starter embed not found.', ephemeral: true });
        return;
    }

    const newEmbed = EmbedBuilder.from(embed);
    let color;
    let desc;

    if (customId === 'ticket_confirm') {
        color = 0x00FF00;
        desc = 'Ticket confirmed. A support channel has been created for you.';
    } else {
        color = 0xFF0000;
        desc = 'Ticket canceled. No support channel has been created.';
    }

    newEmbed.setColor(color);
    newEmbed.setDescription(desc);
    newEmbed.setFooter({ text: 'Moonbeam Staff Team | Use .help to see a list of commands.' });

    await starterMsg.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
    try {
        await starterMsg.reactions.removeAll();
    } catch {}

    if (customId === 'ticket_cancel') {
        tickets.delete(userId);
        await interaction.reply({ content: 'Your ticket has been canceled.', ephemeral: true });
        return;
    }

    const guild = client.guilds.cache.find(g => g.channels.cache.has(SUPPORT_CATEGORY_ID));
    if (!guild) {
        await interaction.reply({ content: 'Support guild or category not configured correctly.', ephemeral: true });
        return;
    }

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
        await interaction.reply({ content: 'Could not fetch user.', ephemeral: true });
        return;
    }

    const channelName = `support-${user.username}`;
    const supportChannel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: SUPPORT_CATEGORY_ID,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: SUPPORT_ROLE_ID,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            }
        ]
    });

    const openEmbed = new EmbedBuilder()
        .setTitle('New Support Ticket')
        .setColor(0x0000FF)
        .setDescription(`Ticket opened by <@${user.id}>.`)
        .setFooter({ text: 'Moonbeam Staff Team | Use .help to see a list of commands.' });

    await supportChannel.send({ embeds: [openEmbed] });

    const ticketData = tickets.get(userId);
    ticketData.channelId = supportChannel.id;
    ticketData.messages.push({
        from: 'system',
        content: 'Ticket created.',
        timestamp: Date.now()
    });

    await interaction.reply({ content: 'Your ticket has been created.', ephemeral: true });
});

client.login(process.env.TOKEN);

// ------------------------------
// KEEP-ALIVE SERVER FOR RENDER
// ------------------------------
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is alive'));

app.listen(process.env.PORT, () => {
    console.log(`Keep-alive server running on port ${process.env.PORT}`);
});


