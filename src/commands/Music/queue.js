import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildQueue } from '../../services/musicService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Shows the current music queue.')
        .setDMPermission(false),
    category: 'Music',
    prefixSupport: true,

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const queueData = getGuildQueue(interaction.guildId);

        if (!queueData || (!queueData.currentSong && queueData.queue.length === 0)) {
            return await InteractionHelper.safeEditReply(interaction, { content: 'The queue is currently empty.' });
        }

        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('🎶 Music Queue');

        let description = '';
        if (queueData.currentSong) {
            description += `**Now Playing:**\n[${queueData.currentSong.title}](${queueData.currentSong.url}) | \`${queueData.currentSong.duration}\`\n\n`;
        }

        if (queueData.queue.length > 0) {
            description += `**Up Next:**\n`;
            for (let i = 0; i < Math.min(queueData.queue.length, 10); i++) {
                const song = queueData.queue[i];
                description += `\`${i + 1}.\` [${song.title}](${song.url}) | \`${song.duration}\`\n`;
            }
            if (queueData.queue.length > 10) {
                description += `\n*...and ${queueData.queue.length - 10} more.*`;
            }
        }

        embed.setDescription(description);

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }
};
